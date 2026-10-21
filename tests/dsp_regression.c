/* Native wrapper tests; the ARM-only binary core is not invoked here. */
/* Enable the wrapper's POSIX/GNU file APIs before any system header on Linux. */
#define _GNU_SOURCE
#include <assert.h>
#include "../twinsampler/dsp_wrapper_monitor.c"

plugin_api_v2_t *twinsampler_core_move_plugin_init_v2(const host_api_v1_t *host) {
    (void)host;
    return NULL;
}

static double rms(const int16_t *out, int count, int channel) {
    double energy = 0;
    for (int i = 0; i < count; i++) energy += (double)out[i * 2 + channel] * out[i * 2 + channel];
    return sqrt(energy / count);
}

static void fill_tone(int16_t *out, int frames, int offset) {
    for (int i = 0; i < frames; i++) {
        int16_t value = (int16_t)(2400 * sin(2 * M_PI * 440 * (i + offset) / 44100));
        out[i * 2] = value; out[i * 2 + 1] = value;
    }
}

static void silent_core_render(void *instance, int16_t *out, int frames) {
    (void)instance;
    memset(out, 0, (size_t)frames * 2 * sizeof(*out));
}

static void check_record_monitor(void) {
    uint8_t memory[8192] = {0};
    host_api_v1_t host = { .sample_rate = 44100, .mapped_memory = memory,
        .audio_out_offset = 256, .audio_in_offset = 2304 };
    plugin_api_v2_t api = { .render_block = silent_core_render };
    wrapper_instance_t *inst = calloc(1, sizeof(*inst));
    assert(inst);
    int16_t backup[256], mix[256], out[256];
    inst->input_backup = backup; inst->input_mix = mix; inst->scratch_samples = 256;
    inst->core_api_v2 = &api; inst->core_instance = inst;
    inst->monitor_enabled = 1; inst->monitor_policy = 1;
    inst->monitor_gain = 1; inst->global_gain = 0.25f; inst->record_mix_schwung = 1;
    inst->record_mix_gain = 1;
    int16_t *input = (int16_t *)(memory + host.audio_in_offset);
    int16_t *bus = (int16_t *)(memory + host.audio_out_offset);
    fill_tone(input, 128, 0);
    g_host = &host;
    for (int recording = 0; recording <= 1; recording++) {
        inst->recording_cached = recording;
        inst->capture_source_last = 0;
        memcpy(bus, input, 256 * sizeof(*bus));
        wrapper_render_block(inst, out, 128);
        assert(rms(out, 128, 0) == 0); // Already audible through Move; don't double it.
        if (recording) assert(inst->capture_source_last == 1); // Don't record input twice either.
        memset(bus, 0, 256 * sizeof(*bus));
        wrapper_render_block(inst, out, 128);
        assert(fabs(rms(out, 128, 0) / rms(input, 128, 0) - 0.25) < 0.002);
    }
    inst->global_gain = 0;
    wrapper_render_block(inst, out, 128);
    assert(rms(out, 128, 0) == 0);
    g_host = NULL;
    free(inst);
}

int main(void) {
    check_record_monitor();
    wrapper_instance_t *inst = calloc(1, sizeof(*inst));
    assert(inst);
    inst->pfx_delay_len = 44100 * 2;
    inst->pfx_delay_buf = calloc(inst->pfx_delay_len * 2, sizeof(float));
    inst->pfx_djfx_buf_len = 22050;
    inst->pfx_djfx_buf = calloc(44100, sizeof(float));
    assert(inst->pfx_delay_buf && inst->pfx_djfx_buf);

    int16_t out[256], reference[256];
    fill_tone(out, 128, 0); memcpy(reference, out, sizeof(out));
    apply_perf_fx_to_output(inst, out, 128);
    assert(memcmp(out, reference, sizeof(out)) == 0);
    assert(inst->pfx_delay_pos == 128);
    assert(fabs(inst->pfx_delay_buf[16]) > 0.001);

    // Lo-fi must update BOTH sample-and-hold channels; mono in stays stereo.
    inst->pfx_global_toggle[4] = 1;
    float lofi[] = {0.5f, 0.4f, 0.2f, 1.0f, 0, 0, 0.9f, 0.37f};
    memcpy(inst->pfx_global_param[4], lofi, sizeof(lofi));
    for (int b = 0; b < 16; b++) { fill_tone(out, 128, b * 128); apply_perf_fx_to_output(inst, out, 128); }
    assert(rms(out, 128, 0) > 10);
    assert(rms(out, 128, 1) > 10);
    assert(memcmp(out, reference, sizeof(out)) != 0);
    for (int i = 0; i < 128; i++) assert(out[i * 2] == out[i * 2 + 1]);

    // The source-loop renderer follows global gain immediately (including mute).
    float audio[512];
    for (int i = 0; i < 512; i++) audio[i] = 0.1f;
    inst->source_sample[0][0].frames_lr = audio;
    inst->source_sample[0][0].frame_count = 256;
    source_loop_voice_t *v = &inst->source_loop_voice[0];
    *v = (source_loop_voice_t){ .active = 1, .loop_mode = 1, .dir = 1,
        .step = 1, .end_frame = 256, .gain = 1, .velocity_gain = 1 };
    wrapper_set_param(inst, "global_gain", "0.25");
    memset(out, 0, sizeof(out)); mix_source_loop_overlays(inst, out, 128);
    assert(out[0] >= 817 && out[0] <= 820);
    wrapper_set_param(inst, "global_gain", "0");
    memset(out, 0, sizeof(out)); mix_source_loop_overlays(inst, out, 128);
    assert(out[0] == 0 && out[255] == 0);

    // Exercise all 45 real preset rows supplied by the JS preset test runner.
    int effect;
    float params[8];
    int tested = 0;
    while (scanf("%d %f %f %f %f %f %f %f %f", &effect, &params[0], &params[1],
                 &params[2], &params[3], &params[4], &params[5], &params[6], &params[7]) == 9) {
        assert(effect >= 0 && effect < 9);
        memset(inst->pfx_global_toggle, 0, sizeof(inst->pfx_global_toggle));
        inst->pfx_global_toggle[effect] = 1;
        memcpy(inst->pfx_global_param[effect], params, sizeof(params));
        double energy[2] = {0, 0};
        for (int block = 0; block < 200; block++) {
            fill_tone(out, 128, block * 128);
            apply_perf_fx_to_output(inst, out, 128);
            if (block >= 160) {
                energy[0] += rms(out, 128, 0);
                energy[1] += rms(out, 128, 1);
                for (int i = 0; i < 256; i++) assert(abs(out[i]) < 32767);
            }
        }
        assert(isfinite(energy[0]) && isfinite(energy[1]));
        // Freeze is intentionally DC/stationary, and its HP stage can remove it.
        if (effect != 8 || params[2] != 0.5f) assert(energy[0] > 1 && energy[1] > 1);
        tested++;
    }
    assert(tested == 45);
    free(inst->pfx_delay_buf); free(inst->pfx_djfx_buf); free(inst);
    puts("DSP checks passed: bypass, stereo lo-fi, loop gain, 45 preset renders");
    return 0;
}
