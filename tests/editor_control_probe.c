/* Replay actual JS control writes against the ARM64 package, in private buffers.
 * stdin: node tests/editor_control_trace.mjs /remote/tone.wav
 * argv: /module/directory /remote/tone.wav */
#define main original_pitch_probe_main
#include "pitch_probe.c"
#undef main

static int make_start_test_wav(const char *path, int start_ms) {
    const int start = (int)(start_ms * 44.1);
    const int frames = start + 44100;
    FILE *f = fopen(path, "wb");
    if (!f) return 0;
    fwrite("RIFF", 1, 4, f); put32(f, 36u + (uint32_t)frames * 4u);
    fwrite("WAVEfmt ", 1, 8, f); put32(f, 16); put16(f, 1); put16(f, 2);
    put32(f, 44100); put32(f, 176400); put16(f, 4); put16(f, 16);
    fwrite("data", 1, 4, f); put32(f, (uint32_t)frames * 4u);
    for (int i = 0; i < frames; i++) {
        const double hz = i < start ? 220 : 880;
        int16_t v = (int16_t)(4096 * sin(6.283185307179586 * hz * i / 44100.0));
        put16(f, (uint16_t)v); put16(f, (uint16_t)v);
    }
    return fclose(f) == 0;
}

int main(int argc, char **argv) {
    if (argc < 3 || !make_wav(argv[2], 44100, 440)) return 2;
    const int expected_cases = argc > 3 ? atoi(argv[3]) : 66;
    const int start_ms = argc > 4 ? atoi(argv[4]) : 1000;
    char path[8192];
    snprintf(path, sizeof(path), "%s/dsp.so", argv[1]);
    void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!lib) { fprintf(stderr, "%s\n", dlerror()); return 2; }
    move_plugin_init_v2_fn init = (move_plugin_init_v2_fn)dlsym(lib, MOVE_PLUGIN_INIT_V2_SYMBOL);
    uint8_t memory[8192] = {0};
    host_api_v1_t host = { .api_version = 1, .sample_rate = 44100, .frames_per_block = 128,
        .mapped_memory = memory, .audio_out_offset = 256, .audio_in_offset = 2304, .log = quiet_log };
    plugin_api_v2_t *api = init ? init(&host) : NULL;
    if (!api) return 2;
    void *inst = NULL;
    char line[16384], label[256] = "", control[64] = "";
    double baseline = 0;
    int failed = 0, cases = 0;
    while (fgets(line, sizeof(line), stdin)) {
        char *value = strchr(line, '\t');
        if (!value) continue;
        *value++ = '\0'; value[strcspn(value, "\r\n")] = '\0';
        if (!strcmp(line, "@case")) {
            if (inst) api->destroy_instance(inst);
            inst = api->create_instance(argv[1], "{}");
            if (!inst || sscanf(value, "%255s %63s", label, control) != 2) return 2;
            if (!strncmp(control, "start", 5)) {
                if (!make_start_test_wav(argv[2], start_ms)) return 2;
            } else if (!make_wav(argv[2], 44100, 440)) return 2;
        } else if (!strcmp(line, "@prime") || !strcmp(line, "@drain")) {
            int16_t out[256];
            const int blocks = !strcmp(line, "@drain") ? 1000 : 2;
            for (int block = 0; block < blocks; block++) api->render_block(inst, out, 128);
        } else if (!strcmp(line, "@measure")) {
            double energy = 0;
            int16_t out[256];
            int prev = 0, crossings = 0, measured = 0;
            for (int block = 0; block < 32; block++) {
                api->render_block(inst, out, 128);
                if (block < 2) continue;
                for (int i = 0; i < 128; i++) {
                    int v = out[i * 2];
                    energy += (double)v * v;
                    int sign = v > 128 ? 1 : v < -128 ? -1 : prev;
                    if (prev < 0 && sign > 0) crossings++;
                    prev = sign; measured++;
                }
            }
            double rms = sqrt(energy / measured);
            double hz = crossings * 44100.0 / measured;
            if (!strcmp(control, "baseline")) baseline = rms;
            double ratio = baseline > 0 ? rms / baseline : 0;
            int ok = !strncmp(control, "start", 5) ? rms > 1 : baseline > 1;
            if (!strcmp(control, "pitch")) ok &= fabs(hz / 880.0 - 1) < 0.06;
            if (!strncmp(control, "start", 5)) {
                const double expected = !strcmp(control, "start-reset") ? 220 : 880;
                ok &= fabs(hz / expected - 1) < 0.06;
                const char *b = strstr(label, "-B");
                char key[64], point[64] = {0};
                snprintf(key, sizeof(key), "section_slice_start_0_%d_0", b ? atoi(b + 2) - 1 : 0);
                const long expected_point = !strcmp(control, "start-reset") ? 0 : lround(start_ms * 44.1);
                ok &= api->get_param && api->get_param(inst, key, point, sizeof(point)) > 0 &&
                    strtol(point, NULL, 10) == expected_point;
            }
            if (!strcmp(control, "gain")) ok &= fabs(ratio - 0.25) < 0.04;
            if (!strcmp(control, "attack")) ok &= ratio < 0.7;
            if (!strcmp(control, "decay")) ok &= ratio < 0.1;
            printf("%s %s: %.1f Hz RMS %.1f ratio %.3f %s\n", label, control, hz, rms, ratio, ok ? "PASS" : "FAIL");
            if (!ok) {
                failed++;
                for (int bank = 0; bank < 8; bank += 7) {
                    char key[64], debug[512] = {0};
                    snprintf(key, sizeof(key), "section_slice_start_0_%d_0", bank);
                    if (api->get_param && api->get_param(inst, key, debug, sizeof(debug)) > 0)
                        printf("  %s=%s\n", key, debug);
                }
            }
            cases++;
        } else if (inst) api->set_param(inst, line, value);
    }
    if (inst) api->destroy_instance(inst);
    dlclose(lib); unlink(argv[2]);
    printf("Editor DSP controls: %d cases, %d failed\n", cases, failed);
    return failed || cases != expected_cases;
}
