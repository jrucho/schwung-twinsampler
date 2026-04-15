#define _GNU_SOURCE

#include <dlfcn.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "plugin_api_v1.h"

typedef struct wrapper_instance {
    void *core_handle;
    plugin_api_v2_t *core_api_v2;
    void *core_instance;
    int monitor_enabled;
    float monitor_gain;
    int record_mix_schwung;
    float record_mix_gain;
    float input_capture_gain;
    int record_intent_internal;
    int record_capture_mode; /* 0=auto 1=input 2=bus 3=mix */
    int monitor_policy; /* 0=always 1=auto-dedupe */
    int recording_cached;
    int16_t *input_backup;
    int16_t *input_mix;
    int scratch_samples;
    int capture_source_last; /* 0=none 1=input 2=bus 3=mix */
    float input_peak_last;
    float bus_peak_last;
    int debug_capture_logs;
    int input_active_prev;
    int bus_active_prev;
    int auto_hold_blocks;
    uint32_t dither_state;
    int sampler_emu_mode; /* 0=clean 1=crunch12 2=punch16 3=dusty26 4=vintage26 */
    float sampler_emu_drive;
    float sampler_emu_wet;
    float sampler_emu_noise;
    float sampler_emu_tone;
    float sampler_emu_comp;
    int sampler_emu_bit_depth;
    float sampler_emu_resample_hz;
    int sampler_emu_hold_counter;
    float sampler_emu_hold_l;
    float sampler_emu_hold_r;
    float sampler_emu_lp_l;
    float sampler_emu_lp_r;
    float sampler_emu_comp_env;
} wrapper_instance_t;

static const host_api_v1_t *g_host = NULL;

static void log_msg(const char *msg) {
    if (g_host && g_host->log) g_host->log(msg);
}

static int clip_i32_to_i16(int32_t x) {
    if (x > 32767) return 32767;
    if (x < -32768) return -32768;
    return (int)x;
}

static float clip_f32(float x, float min_v, float max_v) {
    if (x < min_v) return min_v;
    if (x > max_v) return max_v;
    return x;
}

static float soft_clip(float x) {
    const float ax = fabsf(x);
    return x / (1.0f + ax);
}

static uint32_t xorshift32(uint32_t *state) {
    uint32_t x = (*state) ? (*state) : 0x12345678u;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    return x;
}

static float tpdf_dither_1lsb(uint32_t *state) {
    const float a = (float)(xorshift32(state) & 0xffffu) / 65535.0f;
    const float b = (float)(xorshift32(state) & 0xffffu) / 65535.0f;
    return (a - b);
}

static int16_t float_to_i16_dithered(float x, uint32_t *state) {
    float s = x + tpdf_dither_1lsb(state);
    if (s > 32767.0f) s = 32767.0f;
    if (s < -32768.0f) s = -32768.0f;
    return (int16_t)s;
}

static int parse_bool(const char *val) {
    if (!val) return 0;
    if (!strcmp(val, "1")) return 1;
    if (!strcasecmp(val, "true")) return 1;
    if (!strcasecmp(val, "on")) return 1;
    if (!strcasecmp(val, "yes")) return 1;
    return 0;
}

static int parse_int_or_default(const char *val, int fallback);

static int parse_capture_mode(const char *val, int fallback) {
    if (!val || !val[0]) return fallback;
    if (!strcmp(val, "auto")) return 0;
    if (!strcmp(val, "input")) return 1;
    if (!strcmp(val, "bus")) return 2;
    if (!strcmp(val, "mix")) return 3;
    return parse_int_or_default(val, fallback);
}

static int parse_int_or_default(const char *val, int fallback) {
    if (!val) return fallback;
    char *end = NULL;
    long v = strtol(val, &end, 10);
    if (!end || end == val) return fallback;
    return (int)v;
}

static float parse_float_clamped(const char *val, float min_v, float max_v, float fallback) {
    if (!val) return fallback;
    char *end = NULL;
    double v = strtod(val, &end);
    if (!end || end == val) return fallback;
    if (v < min_v) v = min_v;
    if (v > max_v) v = max_v;
    return (float)v;
}

static int load_core_for_instance(wrapper_instance_t *inst, const char *module_dir) {
    if (!inst) return 0;
    if (!module_dir || !module_dir[0]) {
        log_msg("TwinSampler monitor wrapper: missing module_dir");
        return 0;
    }

    char core_path[PATH_MAX];
    snprintf(core_path, sizeof(core_path), "%s/dsp_core.so", module_dir);

    void *handle = dlopen(core_path, RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
        const char *err = dlerror();
        log_msg(err ? err : "TwinSampler monitor wrapper: dlopen core failed");
        return 0;
    }

    move_plugin_init_v2_fn init_v2 =
        (move_plugin_init_v2_fn)dlsym(handle, MOVE_PLUGIN_INIT_V2_SYMBOL);
    if (!init_v2) {
        dlclose(handle);
        log_msg("TwinSampler monitor wrapper: core missing move_plugin_init_v2");
        return 0;
    }

    plugin_api_v2_t *api = init_v2(g_host);
    if (!api || !api->create_instance || !api->render_block) {
        dlclose(handle);
        log_msg("TwinSampler monitor wrapper: invalid core API v2");
        return 0;
    }

    inst->core_handle = handle;
    inst->core_api_v2 = api;
    log_msg("TwinSampler monitor wrapper: core loaded (per-instance)");
    return 1;
}

static float peak_abs_i16(const int16_t *buf, int samples) {
    if (!buf || samples <= 0) return 0.0f;
    int32_t peak = 0;
    for (int i = 0; i < samples; i++) {
        int32_t v = buf[i];
        if (v < 0) v = -v;
        if (v > peak) peak = v;
    }
    return (float)peak / 32767.0f;
}

static const char* capture_source_name(int capture_source) {
    if (capture_source == 1) return "input";
    if (capture_source == 2) return "bus";
    if (capture_source == 3) return "mix";
    return "none";
}

static void* wrapper_create_instance(const char *module_dir, const char *json_defaults) {
    wrapper_instance_t *inst = (wrapper_instance_t *)calloc(1, sizeof(wrapper_instance_t));
    if (!inst) return NULL;

    inst->monitor_enabled = 0;
    inst->monitor_gain = 1.0f;
    inst->record_mix_schwung = 1;
    inst->record_mix_gain = 1.0f;
    inst->input_capture_gain = 1.0f;
    inst->record_intent_internal = 0;
    inst->record_capture_mode = 0;
    inst->monitor_policy = 1;
    inst->recording_cached = 0;
    inst->capture_source_last = 0;
    inst->input_peak_last = 0.0f;
    inst->bus_peak_last = 0.0f;
    inst->debug_capture_logs = 0;
    inst->input_active_prev = 0;
    inst->bus_active_prev = 0;
    inst->auto_hold_blocks = 0;
    inst->dither_state = 0x6d2b79f5u;
    inst->sampler_emu_mode = 0;
    inst->sampler_emu_drive = 1.0f;
    inst->sampler_emu_wet = 1.0f;
    inst->sampler_emu_noise = 0.0f;
    inst->sampler_emu_tone = 0.8f;
    inst->sampler_emu_comp = 0.30f;
    inst->sampler_emu_bit_depth = 16;
    inst->sampler_emu_resample_hz = 44100.0f;
    inst->sampler_emu_hold_counter = 0;
    inst->sampler_emu_hold_l = 0.0f;
    inst->sampler_emu_hold_r = 0.0f;
    inst->sampler_emu_lp_l = 0.0f;
    inst->sampler_emu_lp_r = 0.0f;
    inst->sampler_emu_comp_env = 0.0f;
    inst->scratch_samples = ((g_host && g_host->frames_per_block > 0) ? g_host->frames_per_block : 128) * 2;
    inst->input_backup = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    inst->input_mix = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    if (!inst->input_backup || !inst->input_mix) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst);
        log_msg("TwinSampler monitor wrapper: scratch alloc failed");
        return NULL;
    }
    if (!load_core_for_instance(inst, module_dir)) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst);
        return NULL;
    }
    inst->core_instance = inst->core_api_v2->create_instance(module_dir, json_defaults);

    if (!inst->core_instance) {
        if (inst->core_handle) {
            dlclose(inst->core_handle);
            inst->core_handle = NULL;
        }
        inst->core_api_v2 = NULL;
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst);
        log_msg("TwinSampler monitor wrapper: core create_instance failed");
        return NULL;
    }

    log_msg("TwinSampler monitor wrapper: instance created");
    return inst;
}

static void wrapper_destroy_instance(void *instance) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst) return;

    if (inst->core_api_v2 && inst->core_api_v2->destroy_instance && inst->core_instance) {
        inst->core_api_v2->destroy_instance(inst->core_instance);
    }
    if (inst->core_handle) {
        dlclose(inst->core_handle);
        inst->core_handle = NULL;
    }
    inst->core_api_v2 = NULL;
    free(inst->input_backup);
    free(inst->input_mix);
    free(inst);
    log_msg("TwinSampler monitor wrapper: instance destroyed");
}

static int is_monitor_key(const char *key) {
    if (!key) return 0;
    return (!strcmp(key, "record_monitor")
        || !strcmp(key, "input_monitor")
        || !strcmp(key, "monitor_input")
        || !strcmp(key, "input_thru")
        || !strcmp(key, "monitor"));
}

static int core_is_recording(wrapper_instance_t *inst) {
    if (!inst) return 0;
    if (!inst->core_api_v2 || !inst->core_api_v2->get_param || !inst->core_instance) return inst->recording_cached;

    char buf[32];
    const int len = inst->core_api_v2->get_param(inst->core_instance, "recording", buf, (int)sizeof(buf));
    if (len > 0) {
        buf[(len < (int)sizeof(buf) - 1) ? len : ((int)sizeof(buf) - 1)] = '\0';
        inst->recording_cached = (parse_int_or_default(buf, inst->recording_cached) > 0) ? 1 : 0;
    }
    return inst->recording_cached;
}

static void wrapper_set_param(void *instance, const char *key, const char *val) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst || !key) return;

    if (is_monitor_key(key)) {
        inst->monitor_enabled = parse_bool(val);
        return;
    }
    if (!strcmp(key, "monitor_gain")) {
        inst->monitor_gain = parse_float_clamped(val, 0.0f, 2.0f, inst->monitor_gain);
        return;
    }
    if (!strcmp(key, "record_mix_schwung")) {
        inst->record_mix_schwung = parse_bool(val);
        return;
    }
    if (!strcmp(key, "record_mix_gain")) {
        inst->record_mix_gain = parse_float_clamped(val, 0.0f, 2.0f, inst->record_mix_gain);
        return;
    }
    if (!strcmp(key, "input_capture_gain")) {
        inst->input_capture_gain = parse_float_clamped(val, 0.0f, 1.0f, inst->input_capture_gain);
        return;
    }
    if (!strcmp(key, "record_intent_internal")) {
        inst->record_intent_internal = parse_bool(val);
        return;
    }
    if (!strcmp(key, "record_capture_mode")) {
        inst->record_capture_mode = parse_capture_mode(val, inst->record_capture_mode);
        return;
    }
    if (!strcmp(key, "monitor_policy")) {
        inst->monitor_policy = parse_int_or_default(val, inst->monitor_policy) ? 1 : 0;
        return;
    }
    if (!strcmp(key, "debug_capture_logs")) {
        inst->debug_capture_logs = parse_bool(val);
        return;
    }
    if (!strcmp(key, "sampler_emu_mode")) {
        inst->sampler_emu_mode = parse_int_or_default(val, inst->sampler_emu_mode);
        if (inst->sampler_emu_mode < 0) inst->sampler_emu_mode = 0;
        if (inst->sampler_emu_mode > 4) inst->sampler_emu_mode = 4;
        return;
    }
    if (!strcmp(key, "sampler_emu_drive")) {
        inst->sampler_emu_drive = parse_float_clamped(val, 0.25f, 4.0f, inst->sampler_emu_drive);
        return;
    }
    if (!strcmp(key, "sampler_emu_wet")) {
        inst->sampler_emu_wet = parse_float_clamped(val, 0.0f, 1.0f, inst->sampler_emu_wet);
        return;
    }
    if (!strcmp(key, "sampler_emu_noise")) {
        inst->sampler_emu_noise = parse_float_clamped(val, 0.0f, 1.0f, inst->sampler_emu_noise);
        return;
    }
    if (!strcmp(key, "sampler_emu_tone")) {
        inst->sampler_emu_tone = parse_float_clamped(val, 0.02f, 1.0f, inst->sampler_emu_tone);
        return;
    }
    if (!strcmp(key, "sampler_emu_comp")) {
        inst->sampler_emu_comp = parse_float_clamped(val, 0.0f, 1.0f, inst->sampler_emu_comp);
        return;
    }
    if (!strcmp(key, "sampler_emu_bit_depth")) {
        inst->sampler_emu_bit_depth = parse_int_or_default(val, inst->sampler_emu_bit_depth);
        if (inst->sampler_emu_bit_depth < 4) inst->sampler_emu_bit_depth = 4;
        if (inst->sampler_emu_bit_depth > 16) inst->sampler_emu_bit_depth = 16;
        return;
    }
    if (!strcmp(key, "sampler_emu_resample_hz")) {
        inst->sampler_emu_resample_hz = parse_float_clamped(val, 2000.0f, 96000.0f, inst->sampler_emu_resample_hz);
        return;
    }

    if (!strcmp(key, "record_start")) {
        if (parse_bool(val)) inst->recording_cached = 1;
    } else if (!strcmp(key, "record_stop")) {
        if (parse_bool(val)) inst->recording_cached = 0;
    } else if (!strcmp(key, "recording")) {
        inst->recording_cached = parse_bool(val) ? 1 : 0;
    } else if (!strcmp(key, "record_toggle")) {
        if (parse_bool(val)) inst->recording_cached = inst->recording_cached ? 0 : 1;
    }

    if (inst->core_api_v2 && inst->core_api_v2->set_param && inst->core_instance) {
        inst->core_api_v2->set_param(inst->core_instance, key, val ? val : "");
    }
}

static int wrapper_get_param(void *instance, const char *key, char *buf, int buf_len) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst || !key || !buf || buf_len <= 0) return -1;

    if (is_monitor_key(key)) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->monitor_enabled ? 1 : 0);
    }
    if (!strcmp(key, "monitor_gain")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->monitor_gain);
    }
    if (!strcmp(key, "record_mix_schwung")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->record_mix_schwung ? 1 : 0);
    }
    if (!strcmp(key, "record_mix_gain")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->record_mix_gain);
    }
    if (!strcmp(key, "input_capture_gain")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->input_capture_gain);
    }
    if (!strcmp(key, "record_intent_internal")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->record_intent_internal ? 1 : 0);
    }
    if (!strcmp(key, "record_capture_mode")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->record_capture_mode);
    }
    if (!strcmp(key, "capture_source_last")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->capture_source_last);
    }
    if (!strcmp(key, "capture_input_peak")) {
        return snprintf(buf, (size_t)buf_len, "%.4f", (double)inst->input_peak_last);
    }
    if (!strcmp(key, "capture_bus_peak")) {
        return snprintf(buf, (size_t)buf_len, "%.4f", (double)inst->bus_peak_last);
    }
    if (!strcmp(key, "sampler_emu_mode")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->sampler_emu_mode);
    }
    if (!strcmp(key, "sampler_emu_drive")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->sampler_emu_drive);
    }
    if (!strcmp(key, "sampler_emu_wet")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->sampler_emu_wet);
    }
    if (!strcmp(key, "sampler_emu_noise")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->sampler_emu_noise);
    }
    if (!strcmp(key, "sampler_emu_tone")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->sampler_emu_tone);
    }
    if (!strcmp(key, "sampler_emu_comp")) {
        return snprintf(buf, (size_t)buf_len, "%.3f", (double)inst->sampler_emu_comp);
    }
    if (!strcmp(key, "sampler_emu_bit_depth")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->sampler_emu_bit_depth);
    }
    if (!strcmp(key, "sampler_emu_resample_hz")) {
        return snprintf(buf, (size_t)buf_len, "%.1f", (double)inst->sampler_emu_resample_hz);
    }

    if (inst->core_api_v2 && inst->core_api_v2->get_param && inst->core_instance) {
        return inst->core_api_v2->get_param(inst->core_instance, key, buf, buf_len);
    }
    return -1;
}

static int wrapper_get_error(void *instance, char *buf, int buf_len) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst || !buf || buf_len <= 0) return 0;

    if (inst->core_api_v2 && inst->core_api_v2->get_error && inst->core_instance) {
        return inst->core_api_v2->get_error(inst->core_instance, buf, buf_len);
    }
    return 0;
}

typedef struct sampler_emu_preset {
    float drive;
    float tone;
    float noise;
    int bit_depth;
    float sample_rate;
} sampler_emu_preset_t;

static sampler_emu_preset_t preset_for_mode(int mode) {
    sampler_emu_preset_t p = { 1.0f, 0.85f, 0.0f, 16, 44100.0f };
    if (mode == 1) { /* Crunch 12: gritty, lower bandwidth, extra character */
        p.drive = 1.20f; p.tone = 0.42f; p.noise = 0.015f; p.bit_depth = 12; p.sample_rate = 40000.0f;
    } else if (mode == 2) { /* Punch 16: cleaner punch, mild color */
        p.drive = 1.10f; p.tone = 0.62f; p.noise = 0.009f; p.bit_depth = 16; p.sample_rate = 44100.0f;
    } else if (mode == 3) { /* Dusty 26: darker/lofi texture */
        p.drive = 1.55f; p.tone = 0.28f; p.noise = 0.020f; p.bit_depth = 12; p.sample_rate = 26000.0f;
    } else if (mode == 4) { /* Vintage 26: crunchy transients, low bandwidth */
        p.drive = 1.30f; p.tone = 0.22f; p.noise = 0.013f; p.bit_depth = 12; p.sample_rate = 26040.0f;
    }
    return p;
}

static void apply_sampler_emu(wrapper_instance_t *inst, int16_t *out_interleaved_lr, int frames) {
    if (!inst || !out_interleaved_lr || frames <= 0) return;
    int mode = inst->sampler_emu_mode;
    if (mode < 0) mode = 0;
    if (mode > 4) mode = 4;

    const sampler_emu_preset_t preset = preset_for_mode(mode);
    const float wet = clip_f32(inst->sampler_emu_wet, 0.0f, 1.0f);
    if (wet <= 0.0001f) return;

    const int sr = (g_host && g_host->sample_rate > 1000) ? g_host->sample_rate : MOVE_SAMPLE_RATE;
    if (mode == 0) {
        const int neutral_bits = (inst->sampler_emu_bit_depth >= 16);
        const int neutral_rate = (inst->sampler_emu_resample_hz >= (float)(sr - 1));
        const float neutral_drive = fabsf(inst->sampler_emu_drive - 1.0f);
        const int near_clean = neutral_bits && neutral_rate &&
            neutral_drive < 0.01f &&
            fabsf(inst->sampler_emu_noise) < 0.0005f &&
            fabsf(inst->sampler_emu_comp) < 0.0005f;
        if (near_clean) return;
    }

    float target_rate = clip_f32(inst->sampler_emu_resample_hz, 2000.0f, 96000.0f);
    if (target_rate > preset.sample_rate) target_rate = preset.sample_rate;
    if (target_rate > (float)sr) target_rate = (float)sr;
    int hold_samples = (int)roundf((float)sr / target_rate);
    if (hold_samples < 1) hold_samples = 1;

    int bit_depth = inst->sampler_emu_bit_depth;
    if (bit_depth > preset.bit_depth) bit_depth = preset.bit_depth;
    if (bit_depth < 4) bit_depth = 4;
    const float q_levels = (float)(1 << (bit_depth - 1));

    const float drive = clip_f32(inst->sampler_emu_drive * preset.drive, 0.25f, 8.0f);
    const float noise_amp = clip_f32(inst->sampler_emu_noise + preset.noise, 0.0f, 1.0f) * (1.0f / 32768.0f) * 18.0f;
    const float tone = clip_f32(inst->sampler_emu_tone * preset.tone, 0.02f, 1.0f);
    const float comp = clip_f32(inst->sampler_emu_comp, 0.0f, 1.0f);
    const float comp_threshold = 0.42f - (comp * 0.18f);
    const float comp_ratio = 1.0f + (comp * 9.0f);
    const float comp_attack = 0.25f + (comp * 0.35f);
    const float comp_release = 0.025f + (comp * 0.035f);

    int hold_counter = inst->sampler_emu_hold_counter;
    float hold_l = inst->sampler_emu_hold_l;
    float hold_r = inst->sampler_emu_hold_r;
    float lp_l = inst->sampler_emu_lp_l;
    float lp_r = inst->sampler_emu_lp_r;
    float comp_env = inst->sampler_emu_comp_env;

    for (int f = 0; f < frames; f++) {
        const int idx = f * 2;
        const float dry_l = (float)out_interleaved_lr[idx] * (1.0f / 32768.0f);
        const float dry_r = (float)out_interleaved_lr[idx + 1] * (1.0f / 32768.0f);

        if (hold_counter <= 0) {
            hold_l = dry_l;
            hold_r = dry_r;
            hold_counter = hold_samples - 1;
        } else {
            hold_counter--;
        }

        lp_l += tone * (hold_l - lp_l);
        lp_r += tone * (hold_r - lp_r);

        const float n_l = tpdf_dither_1lsb(&inst->dither_state) * noise_amp;
        const float n_r = tpdf_dither_1lsb(&inst->dither_state) * noise_amp;

        const float sat_l = soft_clip((lp_l + n_l) * drive);
        const float sat_r = soft_clip((lp_r + n_r) * drive);
        const float crushed_l = roundf(sat_l * q_levels) / q_levels;
        const float crushed_r = roundf(sat_r * q_levels) / q_levels;

        float mixed_l = dry_l * (1.0f - wet) + crushed_l * wet;
        float mixed_r = dry_r * (1.0f - wet) + crushed_r * wet;

        if (comp > 0.0001f) {
            const float level = fmaxf(fabsf(mixed_l), fabsf(mixed_r));
            if (level > comp_env) comp_env += (level - comp_env) * comp_attack;
            else comp_env += (level - comp_env) * comp_release;

            if (comp_env > comp_threshold) {
                const float over = comp_env / fmaxf(comp_threshold, 1.0e-6f);
                const float gain = powf(over, -(1.0f - (1.0f / comp_ratio)));
                mixed_l *= gain;
                mixed_r *= gain;
            }
        }

        const int32_t out_l = (int32_t)lrintf(clip_f32(mixed_l, -1.0f, 0.9999695f) * 32767.0f);
        const int32_t out_r = (int32_t)lrintf(clip_f32(mixed_r, -1.0f, 0.9999695f) * 32767.0f);
        out_interleaved_lr[idx] = (int16_t)clip_i32_to_i16(out_l);
        out_interleaved_lr[idx + 1] = (int16_t)clip_i32_to_i16(out_r);
    }

    inst->sampler_emu_hold_counter = hold_counter;
    inst->sampler_emu_hold_l = hold_l;
    inst->sampler_emu_hold_r = hold_r;
    inst->sampler_emu_lp_l = lp_l;
    inst->sampler_emu_lp_r = lp_r;
    inst->sampler_emu_comp_env = comp_env;
}

static void wrapper_render_block(void *instance, int16_t *out_interleaved_lr, int frames) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst || !out_interleaved_lr || frames <= 0) return;

    const int total = frames * 2;
    int input_replaced = 0;
    int16_t *audio_in_rw = NULL;

    int capture_source = 0;

    if (g_host && g_host->mapped_memory &&
        inst->input_backup &&
        inst->input_mix &&
        total <= inst->scratch_samples &&
        g_host->audio_in_offset > 0 &&
        g_host->audio_out_offset > 0 &&
        core_is_recording(inst)) {
        audio_in_rw = (int16_t *)(g_host->mapped_memory + g_host->audio_in_offset);
        const int16_t *schwung_bus = (const int16_t *)(g_host->mapped_memory + g_host->audio_out_offset);
        if (audio_in_rw && schwung_bus) {
            const float input_peak = peak_abs_i16(audio_in_rw, total);
            const float bus_peak = peak_abs_i16(schwung_bus, total);
            const int input_active = (input_peak > 0.012f) || (inst->input_active_prev && input_peak > 0.006f);
            const int bus_active = (bus_peak > 0.012f) || (inst->bus_active_prev && bus_peak > 0.006f);
            inst->input_peak_last = input_peak;
            inst->bus_peak_last = bus_peak;
            inst->input_active_prev = input_active;
            inst->bus_active_prev = bus_active;

            int desired_capture_source = 1; /* clean-by-default input path */
            if (inst->record_capture_mode == 3) {
                desired_capture_source = 3;
            } else if (inst->record_capture_mode == 2) {
                desired_capture_source = 2;
            } else if (inst->record_capture_mode == 1) {
                desired_capture_source = 1;
            } else {
                if (input_active && bus_active) desired_capture_source = 3;
                else if (input_active) desired_capture_source = 1;
                else if (bus_active) desired_capture_source = 2;
                else desired_capture_source = 1;
            }
            capture_source = desired_capture_source;
            if (inst->record_capture_mode == 0 && inst->capture_source_last > 0 &&
                desired_capture_source != inst->capture_source_last) {
                if (inst->auto_hold_blocks < 16) {
                    capture_source = inst->capture_source_last;
                    inst->auto_hold_blocks++;
                } else {
                    inst->auto_hold_blocks = 0;
                }
            } else {
                inst->auto_hold_blocks = 0;
            }

            memcpy(inst->input_backup, audio_in_rw, (size_t)total * sizeof(int16_t));
            if (capture_source == 2) {
                const float rec_gain = inst->record_mix_gain;
                for (int i = 0; i < total; i++) {
                    const int32_t bus_only = (int32_t)((float)schwung_bus[i] * rec_gain);
                    inst->input_mix[i] = (int16_t)clip_i32_to_i16(bus_only);
                }
                memcpy(audio_in_rw, inst->input_mix, (size_t)total * sizeof(int16_t));
                input_replaced = 1;
            } else if (capture_source == 1) {
                const float in_gain = inst->input_capture_gain;
                if (in_gain < 0.9995f) {
                    for (int i = 0; i < total; i++) {
                        const float in_f = (float)audio_in_rw[i] * in_gain;
                        inst->input_mix[i] = float_to_i16_dithered(in_f, &inst->dither_state);
                    }
                    memcpy(audio_in_rw, inst->input_mix, (size_t)total * sizeof(int16_t));
                    input_replaced = 1;
                }
            } else if (capture_source == 3 && inst->record_mix_schwung) {
                const float rec_gain = inst->record_mix_gain;
                const float in_gain = inst->input_capture_gain;
                const float dual_mix_gain = 0.70710678f;
                for (int i = 0; i < total; i++) {
                    const float in_f = ((float)audio_in_rw[i] * in_gain) * dual_mix_gain;
                    const float bus_f = ((float)schwung_bus[i] * rec_gain) * dual_mix_gain;
                    const float rec_mix = in_f + bus_f;
                    inst->input_mix[i] = float_to_i16_dithered(rec_mix, &inst->dither_state);
                }
                memcpy(audio_in_rw, inst->input_mix, (size_t)total * sizeof(int16_t));
                input_replaced = 1;
            }
            if (inst->capture_source_last != capture_source && inst->debug_capture_logs) {
                char msg[192];
                snprintf(msg, sizeof(msg),
                    "TwinSampler capture=%s inPeak=%.3f busPeak=%.3f intentInternal=%d",
                    capture_source_name(capture_source),
                    (double)input_peak,
                    (double)bus_peak,
                    inst->record_intent_internal ? 1 : 0);
                log_msg(msg);
            }
            inst->capture_source_last = capture_source;
        }
    }

    if (inst->core_api_v2 && inst->core_api_v2->render_block && inst->core_instance) {
        inst->core_api_v2->render_block(inst->core_instance, out_interleaved_lr, frames);
    } else {
        memset(out_interleaved_lr, 0, (size_t)frames * 2 * sizeof(int16_t));
    }

    if (input_replaced && audio_in_rw) {
        memcpy(audio_in_rw, inst->input_backup, (size_t)total * sizeof(int16_t));
    }

    if (!inst->monitor_enabled || !g_host || !g_host->mapped_memory) return;
    if (inst->monitor_policy && core_is_recording(inst) && capture_source == 2) return;

    if (g_host->audio_in_offset <= 0) return;
    const int16_t *audio_in = (const int16_t *)(g_host->mapped_memory + g_host->audio_in_offset);
    if (!audio_in) return;

    const float gain = inst->monitor_gain * inst->input_capture_gain;
    for (int i = 0; i < total; i++) {
        const int32_t mon = (int32_t)((float)audio_in[i] * gain);
        const int32_t sum = (int32_t)out_interleaved_lr[i] + mon;
        out_interleaved_lr[i] = (int16_t)clip_i32_to_i16(sum);
    }

    /* Final stage coloration on full TwinSampler output (post monitor mix). */
    apply_sampler_emu(inst, out_interleaved_lr, frames);
}

static plugin_api_v2_t g_wrapper_api_v2 = {
    .api_version = MOVE_PLUGIN_API_VERSION_2,
    .create_instance = wrapper_create_instance,
    .destroy_instance = wrapper_destroy_instance,
    .on_midi = NULL,
    .set_param = wrapper_set_param,
    .get_param = wrapper_get_param,
    .get_error = wrapper_get_error,
    .render_block = wrapper_render_block,
};

plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    return &g_wrapper_api_v2;
}
