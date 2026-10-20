/* Standalone ARM64 diagnostic. Renders into private buffers, never the Move
 * output. Run: audio_probe /path/to/twinsampler /data/.../temporary-probe.wav */
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

static int make_wav(const char *path) {
    FILE *f = fopen(path, "wbx");
    if (!f) return 0;
    const int frames = 4410 * 16;
    fwrite("RIFF", 1, 4, f); put32(f, 36 + frames * 4);
    fwrite("WAVEfmt ", 1, 8, f); put32(f, 16); put16(f, 1); put16(f, 2);
    put32(f, 44100); put32(f, 44100 * 4); put16(f, 4); put16(f, 16);
    fwrite("data", 1, 4, f); put32(f, frames * 4);
    for (int i = 0; i < frames; i++) {
        int16_t v = (int16_t)(4096 * sin(6.283185307179586 * 220 * i / 44100.0));
        put16(f, (uint16_t)v); put16(f, (uint16_t)v);
    }
    return fclose(f) == 0;
}

static double render(plugin_api_v2_t *api, const char *dir, const char *wav,
                     int loop, float gain, int velocity, int pad_mode) {
    void *inst = api->create_instance(dir, "{}");
    if (!inst) { fprintf(stderr, "instance failed\n"); exit(2); }
    char value[8192];
    api->set_param(inst, "section_mode", pad_mode ? "0:1" : "0:0");
    api->set_param(inst, "section_bank", "0:0");
    api->set_param(inst, "section_chop_count", "0:0:16");
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
    snprintf(value, sizeof(value), "%.3f", gain);
    api->set_param(inst, "global_gain", value);
    snprintf(value, sizeof(value), "68:%d", velocity);
    api->set_param(inst, "pad_note_on", value);
    double energy = 0;
    int16_t out[256];
    for (int block = 0; block < 24; block++) {
        api->render_block(inst, out, 128);
        if (block >= 4) for (int i = 0; i < 256; i++) energy += (double)out[i] * out[i];
    }
    api->destroy_instance(inst);
    return sqrt(energy / (20 * 256));
}

int main(int argc, char **argv) {
    if (argc != 3 || !make_wav(argv[2])) return 2;
    char path[8192];
    snprintf(path, sizeof(path), "%s/dsp.so", argv[1]);
    void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!lib) { fprintf(stderr, "%s\n", dlerror()); unlink(argv[2]); return 2; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(lib, MOVE_PLUGIN_INIT_V2_SYMBOL);
    uint8_t memory[8192] = {0};
    host_api_v1_t host = { .api_version = 1, .sample_rate = 44100, .frames_per_block = 128,
        .mapped_memory = memory, .audio_out_offset = 256, .audio_in_offset = 2304, .log = quiet_log };
    plugin_api_v2_t *api = init ? init(&host) : NULL;
    if (!api) { unlink(argv[2]); return 2; }
    int failed = 0;
    for (int pad = 0; pad < 2; pad++) for (int g = 0; g < 2; g++) for (int v = 0; v < 2; v++) {
        float gain = g ? 1.0f : 0.25f;
        int velocity = v ? 127 : 64;
        double off = render(api, argv[1], argv[2], 0, gain, velocity, pad);
        double on = render(api, argv[1], argv[2], 1, gain, velocity, pad);
        double ping = render(api, argv[1], argv[2], 2, gain, velocity, pad);
        printf("%s gain=%.2f velocity=%d: off=%.2f loop=%.2f ping=%.2f ratio=%.3f\n",
               pad ? "PAD" : "SRC", gain, velocity, off, on, ping, off > 0 ? on / off : 0);
        if (off < 1 || fabs(on / off - 1) > 0.04 || fabs(ping / off - 1) > 0.04) failed = 1;
    }
    unlink(argv[2]);
    dlclose(lib);
    return failed;
}
