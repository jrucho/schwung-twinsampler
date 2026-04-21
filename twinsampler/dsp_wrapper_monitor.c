#define _GNU_SOURCE

#include <dlfcn.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "plugin_api_v1.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct wrapper_instance {
    void *core_handle;
    plugin_api_v2_t *core_api_v2;
    void *core_instance;
    int monitor_enabled;
    float monitor_gain;
    int record_mix_schwung;
    float record_mix_gain;
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
    int current_bank[2];
    int pfx_bank_toggle[2][8][16];
    float pfx_bank_param[2][8][16][8];
    int pfx_global_toggle[16];
    float pfx_global_param[16][8];
    float pfx_lp_z_l;
    float pfx_lp_z_r;
    float pfx_hp_prev_in_l;
    float pfx_hp_prev_in_r;
    float pfx_hp_prev_out_l;
    float pfx_hp_prev_out_r;
    float pfx_loop_length_ms;
    float pfx_comp_env;
    float pfx_phase_flanger;
    float pfx_phase_chorus;
    int pfx_sr_hold_count;
    float pfx_sr_hold_l;
    float pfx_sr_hold_r;
    float *pfx_delay_buf;
    int pfx_delay_len;
    int pfx_delay_pos;
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
    if (!strcmp(val, "true")) return 1;
    if (!strcmp(val, "on")) return 1;
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

static int parse_colon_ints(const char *val, int *out, int max_items) {
    if (!val || !out || max_items <= 0) return 0;
    int count = 0;
    const char *p = val;
    while (*p && count < max_items) {
        char *end = NULL;
        long v = strtol(p, &end, 10);
        if (end == p) return count;
        out[count++] = (int)v;
        if (*end != ':') break;
        p = end + 1;
    }
    return count;
}

static float parse_colon_float_tail(const char *val, float fallback) {
    if (!val) return fallback;
    const char *last = strrchr(val, ':');
    const char *num = last ? (last + 1) : val;
    return parse_float_clamped(num, -16.0f, 16.0f, fallback);
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
    inst->current_bank[0] = 0;
    inst->current_bank[1] = 0;
    for (int sec = 0; sec < 2; sec++) {
        for (int bank = 0; bank < 8; bank++) {
            for (int fx = 0; fx < 16; fx++) {
                inst->pfx_bank_toggle[sec][bank][fx] = 0;
                for (int p = 0; p < 8; p++) inst->pfx_bank_param[sec][bank][fx][p] = 0.5f;
            }
        }
    }
    for (int fx = 0; fx < 16; fx++) {
        inst->pfx_global_toggle[fx] = 0;
        for (int p = 0; p < 8; p++) inst->pfx_global_param[fx][p] = 0.5f;
    }
    inst->pfx_lp_z_l = inst->pfx_lp_z_r = 0.0f;
    inst->pfx_hp_prev_in_l = inst->pfx_hp_prev_in_r = 0.0f;
    inst->pfx_hp_prev_out_l = inst->pfx_hp_prev_out_r = 0.0f;
    inst->pfx_loop_length_ms = 500.0f;
    inst->pfx_comp_env = 0.0f;
    inst->pfx_phase_flanger = 0.0f;
    inst->pfx_phase_chorus = 0.0f;
    inst->pfx_sr_hold_count = 0;
    inst->pfx_sr_hold_l = inst->pfx_sr_hold_r = 0.0f;
    const int sr = (g_host && g_host->sample_rate > 1000) ? g_host->sample_rate : MOVE_SAMPLE_RATE;
    inst->pfx_delay_len = sr * 2;
    inst->pfx_delay_pos = 0;
    inst->pfx_delay_buf = (float *)calloc((size_t)inst->pfx_delay_len * 2u, sizeof(float));
    inst->scratch_samples = ((g_host && g_host->frames_per_block > 0) ? g_host->frames_per_block : 128) * 2;
    inst->input_backup = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    inst->input_mix = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    if (!inst->input_backup || !inst->input_mix || !inst->pfx_delay_buf) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst->pfx_delay_buf);
        free(inst);
        log_msg("TwinSampler monitor wrapper: scratch alloc failed");
        return NULL;
    }
    if (!load_core_for_instance(inst, module_dir)) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst->pfx_delay_buf);
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
        free(inst->pfx_delay_buf);
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
    free(inst->pfx_delay_buf);
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
    if (!strcmp(key, "section_bank")) {
        int parts[2] = {0};
        const int n = parse_colon_ints(val, parts, 2);
        if (n >= 2) {
            const int sec = (parts[0] < 0) ? 0 : (parts[0] > 1 ? 1 : parts[0]);
            const int bank = (parts[1] < 0) ? 0 : (parts[1] > 7 ? 7 : parts[1]);
            inst->current_bank[sec] = bank;
        }
    } else if (!strncmp(key, "section_bank_", 13)) {
        const int sec = (key[13] == '1') ? 1 : 0;
        int bank = parse_int_or_default(val, inst->current_bank[sec]);
        if (bank < 0) bank = 0;
        if (bank > 7) bank = 7;
        inst->current_bank[sec] = bank;
    }

    if (!strcmp(key, "performance_fx_global_toggle") || !strcmp(key, "pfx_global_toggle")) {
        int parts[2] = {0};
        const int n = parse_colon_ints(val, parts, 2);
        if (n >= 2) {
            int fx = parts[0]; if (fx < 0) fx = 0; if (fx > 15) fx = 15;
            inst->pfx_global_toggle[fx] = parts[1] ? 1 : 0;
        }
        return;
    }
    if (!strcmp(key, "performance_fx_global_param") || !strcmp(key, "pfx_global_param")) {
        int parts[2] = {0};
        const int n = parse_colon_ints(val, parts, 2);
        if (n >= 2) {
            int fx = parts[0]; if (fx < 0) fx = 0; if (fx > 15) fx = 15;
            int p = parts[1]; if (p < 0) p = 0; if (p > 7) p = 7;
            inst->pfx_global_param[fx][p] = parse_colon_float_tail(val, inst->pfx_global_param[fx][p]);
            if (inst->pfx_global_param[fx][p] < 0.0f) inst->pfx_global_param[fx][p] = 0.0f;
            if (inst->pfx_global_param[fx][p] > 1.0f) inst->pfx_global_param[fx][p] = 1.0f;
        }
        return;
    }
    if (!strcmp(key, "performance_fx_bank_toggle") || !strcmp(key, "pfx_bank_toggle")) {
        int parts[4] = {0};
        const int n = parse_colon_ints(val, parts, 4);
        if (n >= 4) {
            int sec = parts[0]; if (sec < 0) sec = 0; if (sec > 1) sec = 1;
            int bank = parts[1]; if (bank < 0) bank = 0; if (bank > 7) bank = 7;
            int fx = parts[2]; if (fx < 0) fx = 0; if (fx > 15) fx = 15;
            inst->pfx_bank_toggle[sec][bank][fx] = parts[3] ? 1 : 0;
        }
        return;
    }
    if (!strcmp(key, "performance_fx_bank_param") || !strcmp(key, "pfx_bank_param")) {
        int parts[4] = {0};
        const int n = parse_colon_ints(val, parts, 4);
        if (n >= 4) {
            int sec = parts[0]; if (sec < 0) sec = 0; if (sec > 1) sec = 1;
            int bank = parts[1]; if (bank < 0) bank = 0; if (bank > 7) bank = 7;
            int fx = parts[2]; if (fx < 0) fx = 0; if (fx > 15) fx = 15;
            int p = parts[3]; if (p < 0) p = 0; if (p > 7) p = 7;
            inst->pfx_bank_param[sec][bank][fx][p] = parse_colon_float_tail(val, inst->pfx_bank_param[sec][bank][fx][p]);
            if (inst->pfx_bank_param[sec][bank][fx][p] < 0.0f) inst->pfx_bank_param[sec][bank][fx][p] = 0.0f;
            if (inst->pfx_bank_param[sec][bank][fx][p] > 1.0f) inst->pfx_bank_param[sec][bank][fx][p] = 1.0f;
        }
        return;
    }
    if (!strcmp(key, "performance_fx_loop_length_ms") || !strcmp(key, "pfx_loop_length_ms")) {
        inst->pfx_loop_length_ms = parse_float_clamped(val, 50.0f, 8000.0f, inst->pfx_loop_length_ms);
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
    if (!strcmp(key, "performance_fx_active_banks")) {
        return snprintf(buf, (size_t)buf_len, "%d:%d", inst->current_bank[0], inst->current_bank[1]);
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

static void collect_perf_profile(wrapper_instance_t *inst,
                                 float *drive, float *crush, float *lp, float *hp,
                                 float *transient, float *noise, float *tone, float *out_gain) {
    if (!inst) return;
    float d = 0.0f, c = 0.0f, l = 0.0f, h = 0.0f, t = 0.0f, n = 0.0f, q = 0.0f, g = 0.0f;
    float count = 0.0f;
    for (int fx = 0; fx < 16; fx++) {
        const int g_on = inst->pfx_global_toggle[fx] ? 1 : 0;
        int b_on = 0;
        for (int sec = 0; sec < 2; sec++) {
            for (int bank = 0; bank < 8; bank++) {
                if (inst->pfx_bank_toggle[sec][bank][fx]) { b_on = 1; break; }
            }
            if (b_on) break;
        }
        const int on = g_on || b_on;
        if (!on) continue;
        float p[8];
        for (int i = 0; i < 8; i++) {
            float sum = 0.0f;
            int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][i]; w++; }
            for (int sec = 0; sec < 2; sec++) {
                for (int bank = 0; bank < 8; bank++) {
                    if (!inst->pfx_bank_toggle[sec][bank][fx]) continue;
                    sum += inst->pfx_bank_param[sec][bank][fx][i];
                    w++;
                }
            }
            p[i] = (w > 0) ? (sum / (float)w) : 0.5f;
        }
        d += p[0];
        c += p[1];
        l += p[2];
        h += p[3];
        t += p[4];
        n += p[5];
        q += p[6];
        g += p[7];
        count += 1.0f;
    }
    if (count < 1.0f) count = 1.0f;
    *drive = d / count;
    *crush = c / count;
    *lp = l / count;
    *hp = h / count;
    *transient = t / count;
    *noise = n / count;
    *tone = q / count;
    *out_gain = g / count;
}

static void apply_perf_fx_to_output(wrapper_instance_t *inst, int16_t *out_interleaved_lr, int frames) {
    if (!inst || !out_interleaved_lr || frames <= 0) return;
    if (!inst->pfx_delay_buf || inst->pfx_delay_len <= 0) return;
    const int sr = (g_host && g_host->sample_rate > 1000) ? g_host->sample_rate : MOVE_SAMPLE_RATE;
    const float loop_ms = (inst->pfx_loop_length_ms > 50.0f) ? inst->pfx_loop_length_ms : 500.0f;
    float mix_params[16][8];
    int on[16];
    for (int fx = 0; fx < 16; fx++) {
        const int g_on = inst->pfx_global_toggle[fx] ? 1 : 0;
        int b_on = 0;
        for (int sec = 0; sec < 2; sec++) {
            for (int bank = 0; bank < 8; bank++) {
                if (inst->pfx_bank_toggle[sec][bank][fx]) {
                    b_on = 1;
                    break;
                }
            }
            if (b_on) break;
        }
        on[fx] = g_on || b_on;
        for (int p = 0; p < 8; p++) {
            float sum = 0.0f; int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][p]; w++; }
            for (int sec = 0; sec < 2; sec++) {
                for (int bank = 0; bank < 8; bank++) {
                    if (!inst->pfx_bank_toggle[sec][bank][fx]) continue;
                    sum += inst->pfx_bank_param[sec][bank][fx][p];
                    w++;
                }
            }
            mix_params[fx][p] = (w > 0) ? (sum / (float)w) : 0.5f;
        }
    }

    for (int i = 0; i < frames; i++) {
        float dl = 0.0f, dr = 0.0f;
        int dpos = inst->pfx_delay_pos;
        for (int ch = 0; ch < 2; ch++) {
            const int idx = i * 2 + ch;
            float x = (float)out_interleaved_lr[idx] / 32768.0f;
            float prev_in = (ch == 0) ? inst->pfx_hp_prev_in_l : inst->pfx_hp_prev_in_r;
            float prev_out = (ch == 0) ? inst->pfx_hp_prev_out_l : inst->pfx_hp_prev_out_r;
            float lp_z = (ch == 0) ? inst->pfx_lp_z_l : inst->pfx_lp_z_r;

            /* FX1: Compression + color + sampler controls */
            if (on[0]) {
                const float style = mix_params[0][0];
                const float amt = 0.2f + mix_params[0][1] * 0.8f;
                const float thresh = 0.05f + (1.0f - mix_params[0][2]) * 0.6f;
                const float ratio = 1.0f + mix_params[0][3] * 10.0f;
                const float attack = 0.0005f + mix_params[0][4] * 0.02f;
                const float release = 0.0005f + mix_params[0][5] * 0.05f;
                const float bit_depth = 4.0f + mix_params[0][6] * 20.0f;
                const int sr_hold = 1 + (int)((1.0f - mix_params[0][7]) * 64.0f);
                const float a = fabsf(x);
                if (a > inst->pfx_comp_env) inst->pfx_comp_env += (a - inst->pfx_comp_env) * attack;
                else inst->pfx_comp_env += (a - inst->pfx_comp_env) * release;
                float gr = 1.0f;
                if (inst->pfx_comp_env > thresh) {
                    const float over = inst->pfx_comp_env - thresh;
                    gr = 1.0f / (1.0f + over * ratio * 4.0f * amt);
                }
                x *= gr;
                if (style < 0.25f) {
                    /* clean */
                } else if (style < 0.5f) {
                    x = tanhf(x * 1.4f) * 0.9f; /* dusty */
                } else if (style < 0.75f) {
                    x = tanhf(x * 2.2f); /* punchy */
                } else {
                    x = tanhf(x * 1.7f) + 0.08f * sinf(2.0f * (float)M_PI * x); /* vintage */
                }
                if (inst->pfx_sr_hold_count <= 0) {
                    if (ch == 0) inst->pfx_sr_hold_l = x;
                    else inst->pfx_sr_hold_r = x;
                    inst->pfx_sr_hold_count = sr_hold;
                }
                x = (ch == 0) ? inst->pfx_sr_hold_l : inst->pfx_sr_hold_r;
                if (ch == 1) inst->pfx_sr_hold_count--;
                const float levels = powf(2.0f, bit_depth);
                x = floorf(x * levels + 0.5f) / levels;
            }
            /* FX2 saturation */
            if (on[1]) {
                const float drive = 1.0f + mix_params[1][0] * 12.0f;
                const float mix = mix_params[1][1];
                const float sat = tanhf(x * drive);
                x = x * (1.0f - mix) + sat * mix;
            }
            /* FX3 filter isolator */
            if (on[2]) {
                const float mode = mix_params[2][0];
                const float cut = 0.01f + mix_params[2][1] * 0.94f;
                lp_z += cut * (x - lp_z);
                const float hp = cut * (prev_out + x - prev_in);
                prev_in = x;
                prev_out = hp;
                if (mode < 0.33f) x = lp_z;
                else if (mode < 0.66f) x = lp_z - hp;
                else x = hp;
            }
            /* FX4 bit crush */
            if (on[3]) {
                const float bits = 2.0f + mix_params[3][0] * 14.0f;
                const int hold = 1 + (int)((1.0f - mix_params[3][1]) * 96.0f);
                if (inst->pfx_sr_hold_count <= 0) {
                    if (ch == 0) inst->pfx_sr_hold_l = x;
                    else inst->pfx_sr_hold_r = x;
                    inst->pfx_sr_hold_count = hold;
                }
                x = (ch == 0) ? inst->pfx_sr_hold_l : inst->pfx_sr_hold_r;
                if (ch == 1) inst->pfx_sr_hold_count--;
                const float levels = powf(2.0f, bits);
                x = floorf(x * levels + 0.5f) / levels;
            }
            /* FX5 flanger */
            if (on[4]) {
                const float depth_ms = 0.2f + mix_params[4][0] * 6.0f;
                const float rate = 0.05f + mix_params[4][1] * 2.0f;
                const float fb = (mix_params[4][2] - 0.5f) * 0.8f;
                const float mix = mix_params[4][3];
                inst->pfx_phase_flanger += (2.0f * (float)M_PI * rate) / (float)sr;
                if (inst->pfx_phase_flanger > 2.0f * (float)M_PI) inst->pfx_phase_flanger -= 2.0f * (float)M_PI;
                const float mod_ms = depth_ms * (0.5f + 0.5f * sinf(inst->pfx_phase_flanger));
                int d = (int)((mod_ms / 1000.0f) * (float)sr);
                if (d < 1) d = 1; if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float y = x + delayed * fb;
                x = x * (1.0f - mix) + delayed * mix;
                inst->pfx_delay_buf[dpos * 2 + ch] = y;
            }
            /* FX6 chorus */
            if (on[5]) {
                const float depth_ms = 2.0f + mix_params[5][0] * 18.0f;
                const float rate = 0.05f + mix_params[5][1] * 0.9f;
                const float mix = mix_params[5][2] * 0.8f;
                inst->pfx_phase_chorus += (2.0f * (float)M_PI * rate) / (float)sr;
                if (inst->pfx_phase_chorus > 2.0f * (float)M_PI) inst->pfx_phase_chorus -= 2.0f * (float)M_PI;
                int d = (int)(((depth_ms * (0.5f + 0.5f * sinf(inst->pfx_phase_chorus))) / 1000.0f) * (float)sr);
                if (d < 1) d = 1; if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x;
                x = x * (1.0f - mix) + delayed * mix;
            }
            /* FX7 reverb */
            if (on[6]) {
                const float mix = mix_params[6][0] * 0.7f;
                const float fb = 0.2f + mix_params[6][1] * 0.75f;
                int d = (int)((0.12f + mix_params[6][2] * 0.65f) * (float)sr);
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x + delayed * fb;
                x = x * (1.0f - mix) + delayed * mix;
            }
            /* FX8 delay synced to loop length */
            if (on[7]) {
                const float syncSel = mix_params[7][0];
                const float feedback = mix_params[7][1] * 0.92f;
                const float mix = mix_params[7][2] * 0.8f;
                float div = 0.25f;
                if (syncSel < 0.2f) div = 0.125f;
                else if (syncSel < 0.4f) div = 0.25f;
                else if (syncSel < 0.6f) div = 0.3333f;
                else if (syncSel < 0.8f) div = 0.5f;
                else div = 1.0f;
                int d = (int)(((loop_ms * div) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x + delayed * feedback;
                x = x * (1.0f - mix) + delayed * mix;
                if (ch == 1) {
                    dl = inst->pfx_delay_buf[dpos * 2];
                    dr = inst->pfx_delay_buf[dpos * 2 + 1];
                }
            }

            /* FX9 beat repeat */
            if (on[8]) {
                const float grid = mix_params[8][0];
                const float hold_mix = mix_params[8][1];
                const int div = (grid < 0.25f) ? 4 : (grid < 0.5f) ? 8 : (grid < 0.75f) ? 16 : 32;
                int d = (int)(((loop_ms / (float)div) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float rep = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x;
                x = x * (1.0f - hold_mix) + rep * hold_mix;
            }
            /* FX10 vinyl stop */
            if (on[9]) {
                const float amt = mix_params[9][0];
                float slow = 1.0f - amt * 0.92f;
                if (slow < 0.04f) slow = 0.04f;
                if (slow > 1.0f) slow = 1.0f;
                const float hyst = mix_params[9][1];
                x = (x * slow) + (tanhf(x * 0.8f) * (1.0f - slow) * hyst);
            }
            /* FX11 stutter gate */
            if (on[10]) {
                const float rateSel = mix_params[10][0];
                const float duty = 0.1f + mix_params[10][1] * 0.8f;
                const int div = (rateSel < 0.2f) ? 2 : (rateSel < 0.4f) ? 4 : (rateSel < 0.6f) ? 8 : (rateSel < 0.8f) ? 16 : 32;
                const float ph = fmodf(((float)i / (float)sr) * ((float)div / (loop_ms / 1000.0f)), 1.0f);
                x *= (ph <= duty) ? 1.0f : 0.0f;
            }
            /* FX12 scatter */
            if (on[11]) {
                const float amt = mix_params[11][0];
                const float jitter = mix_params[11][1];
                const int max_d = (int)(amt * 0.06f * (float)sr);
                int d = max_d > 0 ? (int)(fabsf(sinf((float)(i + ch * 131) * (3.0f + jitter * 21.0f))) * (float)max_d) : 0;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float tap = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x;
                x = x * (1.0f - amt) + tap * amt;
            }
            /* FX13 resonator */
            if (on[12]) {
                const float tone = mix_params[12][0];
                const float res = 0.3f + mix_params[12][1] * 0.68f;
                const float f = 0.01f + tone * 0.45f;
                lp_z += f * (x - lp_z);
                x = x * (1.0f - res) + lp_z * res;
            }
            /* FX14 phaser */
            if (on[13]) {
                const float rate = 0.05f + mix_params[13][0] * 1.8f;
                const float depth = mix_params[13][1] * 0.85f;
                const float phase = sinf(((float)i * rate / (float)sr) * 2.0f * (float)M_PI);
                const float allp = x - depth * phase * prev_out;
                x = allp * 0.7f + x * 0.3f;
            }
            /* FX15 lofi wash */
            if (on[14]) {
                const float noise = (mix_params[14][0] - 0.5f) * 0.08f;
                const float blur = 0.01f + mix_params[14][1] * 0.2f;
                lp_z += blur * (x - lp_z);
                x = lp_z + noise * sinf((float)(i * 97 + ch * 53));
            }
            /* FX16 ducker */
            if (on[15]) {
                const float depth = mix_params[15][0] * 0.9f;
                const float release = 0.001f + mix_params[15][1] * 0.02f;
                const float env = fabsf(x);
                float clip = env * 2.0f;
                if (clip < 0.0f) clip = 0.0f;
                if (clip > 1.0f) clip = 1.0f;
                const float duck = 1.0f - depth * clip;
                const float sm = duck + (1.0f - duck) * release;
                x *= sm;
            }

            if (x > 1.0f) x = 1.0f;
            if (x < -1.0f) x = -1.0f;
            out_interleaved_lr[idx] = (int16_t)clip_i32_to_i16((int32_t)(x * 32767.0f));

            if (ch == 0) {
                inst->pfx_hp_prev_in_l = prev_in;
                inst->pfx_hp_prev_out_l = prev_out;
                inst->pfx_lp_z_l = lp_z;
            } else {
                inst->pfx_hp_prev_in_r = prev_in;
                inst->pfx_hp_prev_out_r = prev_out;
                inst->pfx_lp_z_r = lp_z;
            }
        }
        inst->pfx_delay_pos++;
        if (inst->pfx_delay_pos >= inst->pfx_delay_len) inst->pfx_delay_pos = 0;
        (void)dl; (void)dr;
    }
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
            } else if (capture_source == 3 && inst->record_mix_schwung) {
                const float rec_gain = inst->record_mix_gain;
                const float dual_mix_gain = 0.70710678f;
                for (int i = 0; i < total; i++) {
                    const float in_f = (float)audio_in_rw[i] * dual_mix_gain;
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

    if (inst->monitor_enabled && g_host && g_host->mapped_memory &&
        !(inst->monitor_policy && core_is_recording(inst) && capture_source == 2) &&
        g_host->audio_in_offset > 0) {
        const int16_t *audio_in = (const int16_t *)(g_host->mapped_memory + g_host->audio_in_offset);
        if (audio_in) {
            const float gain = inst->monitor_gain;
            for (int i = 0; i < total; i++) {
                const int32_t mon = (int32_t)((float)audio_in[i] * gain);
                const int32_t sum = (int32_t)out_interleaved_lr[i] + mon;
                out_interleaved_lr[i] = (int16_t)clip_i32_to_i16(sum);
            }
        }
    }

    apply_perf_fx_to_output(inst, out_interleaved_lr, frames);
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
