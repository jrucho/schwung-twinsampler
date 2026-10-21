/* Standalone ARM64 pitch diagnostic. Writes only private files/buffers.
 * Run: pitch_probe /path/to/twinsampler /data/.../temporary-pitch.wav */
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include "../twinsampler/plugin_api_v1.h"

static void put16(FILE *f, uint16_t v) { fputc(v & 255, f); fputc(v >> 8, f); }
static void put32(FILE *f, uint32_t v) { put16(f, v & 65535); put16(f, v >> 16); }
static void quiet_log(const char *msg) { (void)msg; }

static int make_wav(const char *path, uint32_t rate, double hz) {
    FILE *f = fopen(path, "wb");
    if (!f) return 0;
    const int frames = (int)(rate * 2);
    fwrite("RIFF", 1, 4, f); put32(f, 36u + (uint32_t)frames * 4u);
    fwrite("WAVEfmt ", 1, 8, f); put32(f, 16); put16(f, 1); put16(f, 2);
    put32(f, rate); put32(f, rate * 4u); put16(f, 4); put16(f, 16);
    fwrite("data", 1, 4, f); put32(f, (uint32_t)frames * 4u);
    for (int i = 0; i < frames; i++) {
        int16_t v = (int16_t)(4096 * sin(6.283185307179586 * hz * i / (double)rate));
        put16(f, (uint16_t)v); put16(f, (uint16_t)v);
    }
    return fclose(f) == 0;
}

static void set_pad_pitch(plugin_api_v2_t *api, void *inst, float semis) {
    char value[128];
    snprintf(value, sizeof(value), "0:0:0:%.3f", semis);
    api->set_param(inst, "slot_pitch_at", value);
    snprintf(value, sizeof(value), "%.3f", semis);
    api->set_param(inst, "slot_pitch", value);
    api->set_param(inst, "slice_pitch", value);
}

static double render(plugin_api_v2_t *api, const char *dir, const char *wav,
                     int pad_mode, int loop, float global_pitch, float slot_pitch) {
    void *inst = api->create_instance(dir, "{}");
    if (!inst) { fprintf(stderr, "instance failed\n"); exit(2); }
    char value[8192];
    api->set_param(inst, "section_mode", pad_mode ? "0:1" : "0:0");
    api->set_param(inst, "section_bank", "0:0");
    api->set_param(inst, "section_chop_count", "0:0:1");
    api->set_param(inst, "section_source_play_mode", "0:0:1");
    snprintf(value, sizeof(value), pad_mode ? "0:0:0:%s" : "0:0:%s", wav);
    api->set_param(inst, pad_mode ? "slot_sample_path" : "section_source_path", value);
    api->set_param(inst, "edit_section", "0");
    api->set_param(inst, "edit_bank", "0");
    api->set_param(inst, "edit_slot", "0");
    api->set_param(inst, "selected_slice", "0");
    api->set_param(inst, "selected_slot", "0");
    api->set_param(inst, "slot_attack_at", "0:0:0:1");
    api->set_param(inst, "slot_attack", "1");
    api->set_param(inst, "slice_attack", "1");
    api->set_param(inst, "slot_decay_at", "0:0:0:10000");
    api->set_param(inst, "slot_decay", "10000");
    api->set_param(inst, "slice_decay", "10000");
    api->set_param(inst, "slot_gain_at", "0:0:0:1");
    api->set_param(inst, "slot_gain", "1");
    api->set_param(inst, "slice_gain", "1");
    snprintf(value, sizeof(value), "0:0:0:%d", loop);
    api->set_param(inst, "slot_loop_at", value);
    snprintf(value, sizeof(value), "%d", loop);
    api->set_param(inst, "slot_loop", value);
    api->set_param(inst, "slice_loop", value);
    api->set_param(inst, "velocity_sens", "1");
    set_pad_pitch(api, inst, slot_pitch);
    snprintf(value, sizeof(value), "%.3f", global_pitch);
    api->set_param(inst, "global_pitch", value);
    api->set_param(inst, "global_gain", "1");
    snprintf(value, sizeof(value), "68:127");
    api->set_param(inst, "pad_note_on", value);

    int16_t out[256];
    int prev = 0;
    int crossings = 0;
    int measured = 0;
    const int blocks = 400;
    for (int block = 0; block < blocks; block++) {
        api->render_block(inst, out, 128);
        if (block < 8) continue;
        for (int i = 0; i < 128; i++) {
            int sample = out[i * 2];
            int sign = sample > 256 ? 1 : (sample < -256 ? -1 : prev);
            if (prev < 0 && sign > 0) crossings++;
            prev = sign;
            measured++;
        }
    }
    api->destroy_instance(inst);
    return measured > 0 ? (double)crossings * 44100.0 / (double)measured : 0.0;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    const uint32_t rates[] = {44100, 48000};
    const float pitches[][2] = {{0.0f, 0.0f}, {-2.5f, 0.0f}, {0.0f, -2.5f}, {-2.5f, -2.5f}};
    char path[8192];
    snprintf(path, sizeof(path), "%s/dsp.so", argv[1]);
    void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!lib) { fprintf(stderr, "%s\n", dlerror()); return 2; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(lib, MOVE_PLUGIN_INIT_V2_SYMBOL);
    uint8_t memory[8192] = {0};
    host_api_v1_t host = { .api_version = 1, .sample_rate = 44100, .frames_per_block = 128,
        .mapped_memory = memory, .audio_out_offset = 256, .audio_in_offset = 2304, .log = quiet_log };
    plugin_api_v2_t *api = init ? init(&host) : NULL;
    if (!api) { dlclose(lib); return 2; }
    int failed = 0;
    for (int ri = 0; ri < 2; ri++) {
        if (!make_wav(argv[2], rates[ri], 440.0)) { dlclose(lib); return 2; }
        for (int pad = 0; pad < 2; pad++) for (int loop = 0; loop < 2; loop++) {
            for (int pi = 0; pi < 4; pi++) {
                double hz = render(api, argv[1], argv[2], pad, loop,
                    pitches[pi][0], pitches[pi][1]);
                double expected = 440.0 * pow(2.0, (pitches[pi][0] + pitches[pi][1]) / 12.0);
                printf("%s %s rate=%u global=%.1f slot=%.1f: %.1f Hz expected %.1f (%.3f)\n",
                    pad ? "PAD " : "SRC ", loop ? "loop" : "shot", rates[ri],
                    pitches[pi][0], pitches[pi][1], hz, expected,
                    expected > 0 ? hz / expected : 0.0);
                if (hz < 1 || fabs(hz / expected - 1.0) > 0.02) failed = 1;
            }
        }
    }
    unlink(argv[2]);
    dlclose(lib);
    return failed;
}
