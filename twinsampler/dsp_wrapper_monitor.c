#define _GNU_SOURCE

#include <dlfcn.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "dsp_core_blob.h"
#include "plugin_api_v1.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct wrapper_instance {
    void *core_handle;
    plugin_api_v2_t *core_api_v2;
    void *core_instance;
    int core_is_static;
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
    float pfx_duck_env;
    float pfx_phase_flanger;
    float pfx_phase_chorus;
    float pfx_phase_vinyl;
    int pfx_sr_hold_count_comp;
    int pfx_sr_hold_count_crush;
    float pfx_sr_hold_l_comp;
    float pfx_sr_hold_r_comp;
    float pfx_sr_hold_l_crush;
    float pfx_sr_hold_r_crush;
    float *pfx_delay_buf;
    int pfx_delay_len;
    int pfx_delay_pos;
} wrapper_instance_t;

static const host_api_v1_t *g_host = NULL;
/* Optional symbol for monolithic builds that link core directly into dsp.so. */
extern plugin_api_v2_t *twinsampler_core_move_plugin_init_v2(const host_api_v1_t *host) __attribute__((weak));

static void log_msg(const char *msg) {
    if (g_host && g_host->log) g_host->log(msg);
}

static int clip_i32_to_i16(int32_t x) {
    if (x > 32767) return 32767;
    if (x < -32768) return -32768;
    return (int)x;
}

static float clampf(float v, float lo, float hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
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

/* Old TwinSampler UI exposes only these 8 DSP FX indices. */
static int is_active_ui_fx_index(int fx_idx) {
    switch (fx_idx) {
        case 12: /* Resonator */
        case 4:  /* Flanger */
        case 5:  /* Chorus */
        case 6:  /* Reverb */
        case 0:  /* Comp Color */
        case 1:  /* Saturation */
        case 2:  /* Isolator */
        case 3:  /* Bit Crush */
            return 1;
        default:
            return 0;
    }
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
    if (!strcmp(val, "line_in")) return 1;
    if (!strcmp(val, "linein")) return 1;
    if (!strcmp(val, "input")) return 1;
    if (!strcmp(val, "internal")) return 2;
    if (!strcmp(val, "move_mix")) return 2;
    if (!strcmp(val, "bus")) return 2;
    if (!strcmp(val, "master")) return 3;
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

static int validate_core_api(plugin_api_v2_t *api) {
    return api && api->create_instance && api->render_block;
}

static int try_load_core_from_handle(wrapper_instance_t *inst, void *handle, int owns_handle) {
    if (!inst || !handle) return 0;

    move_plugin_init_v2_fn init_v2 =
        (move_plugin_init_v2_fn)dlsym(handle, MOVE_PLUGIN_INIT_V2_SYMBOL);
    if (!init_v2) {
        init_v2 = (move_plugin_init_v2_fn)dlsym(handle, "twinsampler_core_move_plugin_init_v2");
    }
    if (!init_v2) {
        if (owns_handle) dlclose(handle);
        return 0;
    }

    plugin_api_v2_t *api = init_v2(g_host);
    if (!validate_core_api(api)) {
        if (owns_handle) dlclose(handle);
        return 0;
    }

    inst->core_handle = owns_handle ? handle : NULL;
    inst->core_api_v2 = api;
    inst->core_is_static = owns_handle ? 0 : 1;
    return 1;
}

static int write_all_bytes(int fd, const uint8_t *data, size_t len) {
    if (fd < 0 || !data || len == 0) return 0;
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, data + off, len - off);
        if (n <= 0) return 0;
        off += (size_t)n;
    }
    return 1;
}

static int try_load_embedded_core(wrapper_instance_t *inst) {
    if (!inst) return 0;
    if (dsp_core_so_len == 0) return 0;

    char tmp_path[] = "/tmp/twinsampler_core_XXXXXX.so";
    int fd = mkstemps(tmp_path, 3);
    if (fd < 0) return 0;

    const int ok = write_all_bytes(fd, (const uint8_t *)dsp_core_so, (size_t)dsp_core_so_len);
    close(fd);
    if (!ok) {
        unlink(tmp_path);
        return 0;
    }

    void *handle = dlopen(tmp_path, RTLD_NOW | RTLD_LOCAL);
    /* Keep filesystem clean; the binary stays mapped if dlopen succeeds. */
    unlink(tmp_path);
    if (!handle) return 0;

    if (try_load_core_from_handle(inst, handle, 1)) {
        log_msg("TwinSampler monitor wrapper: core loaded (embedded)");
        return 1;
    }
    return 0;
}

static int load_core_for_instance(wrapper_instance_t *inst, const char *module_dir) {
    if (!inst) return 0;
    inst->core_handle = NULL;
    inst->core_api_v2 = NULL;
    inst->core_is_static = 0;

    /* 1) Monolithic build where core is linked into this shared object. */
    if (twinsampler_core_move_plugin_init_v2) {
        plugin_api_v2_t *api = twinsampler_core_move_plugin_init_v2(g_host);
        if (validate_core_api(api)) {
            inst->core_api_v2 = api;
            inst->core_is_static = 1;
            log_msg("TwinSampler monitor wrapper: core loaded (static)");
            return 1;
        }
    }

    /* 2) Self-symbol lookup for alternate linked layouts. */
    void *self_handle = dlopen(NULL, RTLD_NOW | RTLD_LOCAL);
    if (self_handle) {
        if (try_load_core_from_handle(inst, self_handle, 0)) {
            dlclose(self_handle);
            log_msg("TwinSampler monitor wrapper: core loaded (self)");
            return 1;
        }
        dlclose(self_handle);
    }

    /* 3) Sidecar core shared object lookup. */
    char core_path_primary[PATH_MAX];
    core_path_primary[0] = '\0';
    if (module_dir && module_dir[0]) {
        snprintf(core_path_primary, sizeof(core_path_primary), "%s/dsp_core.so", module_dir);
    }

    const char *paths[] = {
        core_path_primary,
        "./dsp_core.so",
        "dsp_core.so"
    };
    for (size_t i = 0; i < (sizeof(paths) / sizeof(paths[0])); i++) {
        const char *path = paths[i];
        if (!path || !path[0]) continue;
        void *handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
        if (!handle) continue;
        if (try_load_core_from_handle(inst, handle, 1)) {
            log_msg("TwinSampler monitor wrapper: core loaded (sidecar)");
            return 1;
        }
    }

    /* 4) Last-resort embedded sidecar payload. */
    if (try_load_embedded_core(inst)) {
        return 1;
    }

    const char *err = dlerror();
    log_msg(err ? err : "TwinSampler monitor wrapper: core load failed");
    return 0;
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
    inst->pfx_duck_env = 0.0f;
    inst->pfx_phase_flanger = 0.0f;
    inst->pfx_phase_chorus = 0.0f;
    inst->pfx_phase_vinyl = 0.0f;
    inst->pfx_sr_hold_count_comp = 0;
    inst->pfx_sr_hold_count_crush = 0;
    inst->pfx_sr_hold_l_comp = inst->pfx_sr_hold_r_comp = 0.0f;
    inst->pfx_sr_hold_l_crush = inst->pfx_sr_hold_r_crush = 0.0f;
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
        if (inst->core_handle && !inst->core_is_static) {
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
    if (inst->core_handle && !inst->core_is_static) {
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

static void __attribute__((unused)) collect_perf_profile(wrapper_instance_t *inst,
                                                         float *drive, float *crush, float *lp, float *hp,
                                                         float *transient, float *noise, float *tone, float *out_gain) {
    if (!inst) return;
    float d = 0.0f, c = 0.0f, l = 0.0f, h = 0.0f, t = 0.0f, n = 0.0f, q = 0.0f, g = 0.0f;
    float count = 0.0f;
    for (int fx = 0; fx < 16; fx++) {
        const int g_on = inst->pfx_global_toggle[fx] ? 1 : 0;
        int b_on = 0;
        for (int sec = 0; sec < 2; sec++) {
            int bank = inst->current_bank[sec];
            if (bank < 0 || bank >= 8) bank = 0;
            if (inst->pfx_bank_toggle[sec][bank][fx]) b_on = 1;
        }
        const int on = g_on || b_on;
        if (!on) continue;
        float p[8];
        for (int i = 0; i < 8; i++) {
            float sum = 0.0f;
            int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][i]; w++; }
            for (int sec = 0; sec < 2; sec++) {
                int bank = inst->current_bank[sec];
                if (bank < 0 || bank >= 8) bank = 0;
                if (!inst->pfx_bank_toggle[sec][bank][fx]) continue;
                sum += inst->pfx_bank_param[sec][bank][fx][i];
                w++;
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
    int any_on = 0;
    for (int fx = 0; fx < 16; fx++) {
        if (!is_active_ui_fx_index(fx)) {
            on[fx] = 0;
            for (int p = 0; p < 8; p++) mix_params[fx][p] = 0.5f;
            continue;
        }
        const int g_on = inst->pfx_global_toggle[fx] ? 1 : 0;
        int b_on = 0;
        for (int sec = 0; sec < 2; sec++) {
            int bank = inst->current_bank[sec];
            if (bank < 0 || bank >= 8) bank = 0;
            if (inst->pfx_bank_toggle[sec][bank][fx]) b_on = 1;
        }
        on[fx] = g_on || b_on;
        if (on[fx]) any_on = 1;
        for (int p = 0; p < 8; p++) {
            float sum = 0.0f; int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][p]; w++; }
            for (int sec = 0; sec < 2; sec++) {
                int bank = inst->current_bank[sec];
                if (bank < 0 || bank >= 8) bank = 0;
                if (!inst->pfx_bank_toggle[sec][bank][fx]) continue;
                sum += inst->pfx_bank_param[sec][bank][fx][p];
                w++;
            }
            mix_params[fx][p] = (w > 0) ? (sum / (float)w) : 0.5f;
        }
    }

    /* True bypass: do not touch samples when all FX are off. */
    if (!any_on) return;

    for (int i = 0; i < frames; i++) {
        int dpos = inst->pfx_delay_pos;
        if (on[4]) {
            const float rate = 0.05f + mix_params[4][1] * 2.0f;
            inst->pfx_phase_flanger += (2.0f * (float)M_PI * rate) / (float)sr;
            if (inst->pfx_phase_flanger > 2.0f * (float)M_PI) inst->pfx_phase_flanger -= 2.0f * (float)M_PI;
        }
        if (on[5]) {
            const float rate = 0.05f + mix_params[5][1] * 0.9f;
            inst->pfx_phase_chorus += (2.0f * (float)M_PI * rate) / (float)sr;
            if (inst->pfx_phase_chorus > 2.0f * (float)M_PI) inst->pfx_phase_chorus -= 2.0f * (float)M_PI;
        }
        if (on[9]) {
            const float wow_rate = 0.05f + mix_params[9][4] * 1.2f;
            inst->pfx_phase_vinyl += (2.0f * (float)M_PI * wow_rate) / (float)sr;
            if (inst->pfx_phase_vinyl > 2.0f * (float)M_PI) inst->pfx_phase_vinyl -= 2.0f * (float)M_PI;
        }

        for (int ch = 0; ch < 2; ch++) {
            const int idx = i * 2 + ch;
            float x = (float)out_interleaved_lr[idx] / 32768.0f;
            float prev_in = (ch == 0) ? inst->pfx_hp_prev_in_l : inst->pfx_hp_prev_in_r;
            float prev_out = (ch == 0) ? inst->pfx_hp_prev_out_l : inst->pfx_hp_prev_out_r;
            float lp_z = (ch == 0) ? inst->pfx_lp_z_l : inst->pfx_lp_z_r;
            inst->pfx_delay_buf[dpos * 2 + ch] = x; /* keep delay memory warm for instant toggles */

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
                if (inst->pfx_sr_hold_count_comp <= 0) {
                    if (ch == 0) inst->pfx_sr_hold_l_comp = x;
                    else inst->pfx_sr_hold_r_comp = x;
                    inst->pfx_sr_hold_count_comp = sr_hold;
                }
                x = (ch == 0) ? inst->pfx_sr_hold_l_comp : inst->pfx_sr_hold_r_comp;
                if (ch == 1) inst->pfx_sr_hold_count_comp--;
                const float levels = powf(2.0f, bit_depth);
                x = floorf(x * levels + 0.5f) / levels;
            }
            /* FX2 saturation */
            if (on[1]) {
                const float drive = 1.0f + mix_params[1][0] * 12.0f;
                const float mix = mix_params[1][1];
                const float tone = (mix_params[1][2] - 0.5f) * 1.2f;
                const float output = 0.3f + mix_params[1][3] * 1.7f;
                const float bias = (mix_params[1][4] - 0.5f) * 0.8f;
                const float dynamics = 0.2f + mix_params[1][5] * 1.8f;
                const float lo_cut = mix_params[1][6];
                const float hi_cut = mix_params[1][7];
                const float dyn_drive = drive * (1.0f + (1.0f - clampf(fabsf(x), 0.0f, 1.0f)) * dynamics * 0.5f);
                float sat = tanhf((x + bias) * dyn_drive) - bias * 0.35f;
                const float hp_c = 0.01f + lo_cut * 0.45f;
                const float hp_sat = hp_c * (prev_out + sat - prev_in);
                prev_in = sat;
                prev_out = hp_sat;
                const float lp_c = 0.01f + (1.0f - hi_cut) * 0.45f;
                lp_z += lp_c * (hp_sat - lp_z);
                sat = lp_z + tone * (lp_z - x) * 0.35f;
                x = (x * (1.0f - mix) + sat * mix) * output;
            }
            /* FX3 filter isolator */
            if (on[2]) {
                const float mode = mix_params[2][0];
                const float drive = 1.0f + mix_params[2][3] * 8.0f;
                const float mix = mix_params[2][4];
                const float env_amt = mix_params[2][5] * 0.2f;
                const float lo = mix_params[2][6];
                const float hi = mix_params[2][7];
                const float in = tanhf(x * drive);
                const float cut = clampf(0.01f + mix_params[2][1] * 0.92f + fabsf(in) * env_amt, 0.01f, 0.98f);
                const float res = 0.6f + mix_params[2][2] * 1.4f;
                lp_z += cut * (in - lp_z);
                const float hp = cut * (prev_out + in - prev_in);
                prev_in = in;
                prev_out = hp;
                const float band = (lp_z - hp) * res;
                float y = hp;
                if (mode < 0.33f) y = lp_z;
                else if (mode < 0.66f) y = band;
                y += (lo - 0.5f) * lp_z * 0.35f;
                y += (hi - 0.5f) * hp * 0.35f;
                x = in * (1.0f - mix) + y * mix;
            }
            /* FX4 bit crush */
            if (on[3]) {
                const float bits = 2.0f + mix_params[3][0] * 14.0f;
                const int hold_base = 1 + (int)((1.0f - mix_params[3][1]) * 96.0f);
                const float jitter = mix_params[3][2];
                const float mix = mix_params[3][3];
                const float pre = 0.5f + mix_params[3][4] * 1.5f;
                const float post = 0.5f + mix_params[3][5] * 1.5f;
                const float tilt = (mix_params[3][6] - 0.5f) * 0.8f;
                const float out = 0.3f + mix_params[3][7] * 1.7f;
                const int jitter_delta = (int)(sinf((float)(i * 13 + ch * 97) * (0.017f + jitter * 0.11f)) * ((float)hold_base * jitter * 0.6f));
                int hold = hold_base + jitter_delta;
                if (hold < 1) hold = 1;
                if (hold > 256) hold = 256;
                const float pre_x = tanhf(x * pre);
                if (inst->pfx_sr_hold_count_crush <= 0) {
                    if (ch == 0) inst->pfx_sr_hold_l_crush = pre_x;
                    else inst->pfx_sr_hold_r_crush = pre_x;
                    inst->pfx_sr_hold_count_crush = hold;
                }
                float crushed = (ch == 0) ? inst->pfx_sr_hold_l_crush : inst->pfx_sr_hold_r_crush;
                if (ch == 1) inst->pfx_sr_hold_count_crush--;
                const float levels = powf(2.0f, bits);
                crushed = floorf(crushed * levels + 0.5f) / levels;
                crushed = crushed + tilt * (crushed - x) * 0.5f;
                x = (x * (1.0f - mix) + crushed * mix) * post * out;
            }
            /* FX5 flanger */
            if (on[4]) {
                const float depth_ms = 0.2f + mix_params[4][0] * 6.0f;
                const float fb = (mix_params[4][2] - 0.5f) * 0.8f;
                const float mix = mix_params[4][3];
                const float phase_ofs = mix_params[4][4] * 2.0f * (float)M_PI;
                const float color = mix_params[4][5];
                const float stereo = (mix_params[4][6] - 0.5f) * 1.5f;
                const float out = 0.35f + mix_params[4][7] * 1.65f;
                const float mod_phase = inst->pfx_phase_flanger + phase_ofs + ((ch == 0) ? -stereo : stereo);
                const float mod_ms = depth_ms * (0.5f + 0.5f * sinf(mod_phase));
                int d = (int)((mod_ms / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float colored = delayed * (1.0f - color * 0.5f) + tanhf(delayed * (1.0f + color * 3.0f)) * color * 0.5f;
                const float y = x + colored * fb;
                x = (x * (1.0f - mix) + colored * mix) * out;
                inst->pfx_delay_buf[dpos * 2 + ch] = y;
            }
            /* FX6 chorus */
            if (on[5]) {
                const float depth_ms = 2.0f + mix_params[5][0] * 18.0f;
                const float mix = mix_params[5][2] * 0.8f;
                const float spread = (mix_params[5][3] - 0.5f) * 1.4f;
                const float color = mix_params[5][4];
                const float pre = 0.5f + mix_params[5][5] * 1.5f;
                const float post = 0.5f + mix_params[5][6] * 1.5f;
                const float out = 0.35f + mix_params[5][7] * 1.65f;
                const float in = tanhf(x * pre);
                const float mod_phase = inst->pfx_phase_chorus + ((ch == 0) ? -spread : spread);
                int d = (int)(((depth_ms * (0.5f + 0.5f * sinf(mod_phase))) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float colored = delayed * (1.0f - color * 0.4f) + tanhf(delayed * (1.0f + color * 2.5f)) * color * 0.4f;
                inst->pfx_delay_buf[dpos * 2 + ch] = in;
                x = (in * (1.0f - mix) + colored * mix) * post * out;
            }
            /* FX7 reverb */
            if (on[6]) {
                const float mix = mix_params[6][0] * 0.8f;
                const float fb = 0.15f + mix_params[6][1] * 0.8f;
                const float damp = mix_params[6][3];
                const float pre = 0.5f + mix_params[6][4] * 1.5f;
                const float tone = (mix_params[6][5] - 0.5f) * 0.9f;
                const float stereo = (mix_params[6][6] - 0.5f) * 0.5f;
                const float out = 0.35f + mix_params[6][7] * 1.65f;
                int d = (int)((0.08f + mix_params[6][2] * 0.65f) * (float)sr);
                d += (int)(stereo * 0.02f * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float in = tanhf(x * pre);
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float damp_c = 0.02f + (1.0f - damp) * 0.35f;
                lp_z += damp_c * (delayed - lp_z);
                const float wet = lp_z + tone * (lp_z - in) * 0.35f;
                inst->pfx_delay_buf[dpos * 2 + ch] = in + wet * fb;
                x = (in * (1.0f - mix) + wet * mix) * out;
            }
            /* FX8 delay synced to loop length */
            if (on[7]) {
                const float syncSel = mix_params[7][0];
                const float feedback = mix_params[7][1] * 0.92f;
                const float mix = mix_params[7][2] * 0.85f;
                const float hi_cut = mix_params[7][3];
                const float lo_cut = mix_params[7][4];
                const float duck_amt = mix_params[7][5];
                const float stereo = (mix_params[7][6] - 0.5f) * 0.5f;
                const float out = 0.35f + mix_params[7][7] * 1.65f;
                float div = 0.25f;
                if (syncSel < 0.2f) div = 0.125f;
                else if (syncSel < 0.4f) div = 0.25f;
                else if (syncSel < 0.6f) div = 0.3333f;
                else if (syncSel < 0.8f) div = 0.5f;
                else div = 1.0f;
                int d = (int)(((loop_ms * div) / 1000.0f) * (float)sr);
                d += (int)(stereo * 0.03f * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float hp_c = 0.01f + lo_cut * 0.45f;
                const float hp = hp_c * (prev_out + delayed - prev_in);
                prev_in = delayed;
                prev_out = hp;
                const float lp_c = 0.01f + (1.0f - hi_cut) * 0.45f;
                lp_z += lp_c * (hp - lp_z);
                const float duck = 1.0f - duck_amt * clampf(fabsf(x), 0.0f, 1.0f) * 0.85f;
                const float wet = lp_z * duck;
                inst->pfx_delay_buf[dpos * 2 + ch] = x + wet * feedback;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }

            /* FX9 beat repeat */
            if (on[8]) {
                const float grid = mix_params[8][0];
                const float hold_mix = mix_params[8][1];
                const float mix = mix_params[8][2];
                const float gate = 0.05f + mix_params[8][3] * 0.95f;
                const float tone = (mix_params[8][4] - 0.5f) * 0.8f;
                const float lo_cut = mix_params[8][5];
                const float hi_cut = mix_params[8][6];
                const float out = 0.35f + mix_params[8][7] * 1.65f;
                const int div = (grid < 0.25f) ? 4 : (grid < 0.5f) ? 8 : (grid < 0.75f) ? 16 : 32;
                int d = (int)(((loop_ms / (float)div) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                float rep = inst->pfx_delay_buf[ridx * 2 + ch];
                const float phase = fmodf((float)dpos / (float)d, 1.0f);
                if (phase > gate) rep = 0.0f;
                const float hp_c = 0.01f + lo_cut * 0.45f;
                const float hp = hp_c * (prev_out + rep - prev_in);
                prev_in = rep;
                prev_out = hp;
                const float lp_c = 0.01f + (1.0f - hi_cut) * 0.45f;
                lp_z += lp_c * (hp - lp_z);
                rep = lp_z + tone * (lp_z - x) * 0.25f;
                inst->pfx_delay_buf[dpos * 2 + ch] = x;
                const float wet = x * (1.0f - hold_mix) + rep * hold_mix;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX10 vinyl stop */
            if (on[9]) {
                const float amt = mix_params[9][0];
                const float texture = mix_params[9][1];
                const float mix = mix_params[9][2];
                const float noise = (mix_params[9][3] - 0.5f) * 0.06f;
                const float flutter_rate = 2.0f + mix_params[9][5] * 18.0f;
                const float tone = (mix_params[9][6] - 0.5f) * 0.9f;
                const float out = 0.35f + mix_params[9][7] * 1.65f;
                float slow = 1.0f - amt * 0.92f;
                if (slow < 0.04f) slow = 0.04f;
                if (slow > 1.0f) slow = 1.0f;
                const float wow = sinf(inst->pfx_phase_vinyl + (ch == 0 ? 0.0f : 0.3f)) * 0.12f;
                const float flutter = sinf((float)(i + dpos * 3) * (flutter_rate * 2.0f * (float)M_PI / (float)sr)) * 0.04f;
                float mod = slow + wow + flutter;
                mod = clampf(mod, 0.02f, 1.2f);
                float wet = tanhf(x * (0.6f + texture * 1.8f) * mod);
                wet += noise * sinf((float)(dpos * 73 + ch * 31));
                wet += tone * (wet - x) * 0.3f;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX11 stutter gate */
            if (on[10]) {
                const float rateSel = mix_params[10][0];
                const float duty = 0.05f + mix_params[10][1] * 0.9f;
                const float mix = mix_params[10][2];
                const float swing = (mix_params[10][3] - 0.5f) * 0.8f;
                const float shape = 0.2f + mix_params[10][4] * 6.0f;
                const float tone = (mix_params[10][5] - 0.5f) * 0.8f;
                const float stereo = (mix_params[10][6] - 0.5f) * 0.25f;
                const float out = 0.35f + mix_params[10][7] * 1.65f;
                const int div = (rateSel < 0.2f) ? 2 : (rateSel < 0.4f) ? 4 : (rateSel < 0.6f) ? 8 : (rateSel < 0.8f) ? 16 : 32;
                float ph = fmodf(((float)dpos / (float)sr) * ((float)div / (loop_ms / 1000.0f)), 1.0f);
                ph += (ph < 0.5f) ? swing : -swing;
                ph += (ch == 0) ? -stereo : stereo;
                ph = ph - floorf(ph);
                if (ph < 0.0f) ph += 1.0f;
                float gate = (ph <= duty) ? 1.0f : 0.0f;
                if (shape > 1.0f) {
                    const float edge = duty * 0.5f;
                    if (edge > 0.001f) {
                        const float dist = fabsf(ph - duty * 0.5f) / edge;
                        const float shaped = 1.0f - clampf(dist, 0.0f, 1.0f);
                        gate = powf(shaped, shape);
                    }
                }
                float wet = x * gate;
                wet += tone * (wet - x) * 0.2f;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX12 scatter */
            if (on[11]) {
                const float amt = mix_params[11][0];
                const float jitter = mix_params[11][1];
                const float mix = mix_params[11][2];
                const float gate = mix_params[11][3];
                const float lo_cut = mix_params[11][4];
                const float hi_cut = mix_params[11][5];
                const float stereo = (mix_params[11][6] - 0.5f) * 0.4f;
                const float out = 0.35f + mix_params[11][7] * 1.65f;
                const int max_d = (int)(amt * 0.06f * (float)sr);
                int d = max_d > 0 ? (int)(fabsf(sinf((float)(dpos + i + ch * 131) * (3.0f + jitter * 27.0f))) * (float)max_d) : 0;
                d += (int)(stereo * (float)max_d);
                if (d < 0) d = 0;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                float tap = inst->pfx_delay_buf[ridx * 2 + ch];
                inst->pfx_delay_buf[dpos * 2 + ch] = x;
                const float gate_open = (fabsf(sinf((float)(dpos + ch * 17) * (0.37f + jitter))) <= (0.05f + gate * 0.95f)) ? 1.0f : 0.0f;
                tap *= gate_open;
                const float hp_c = 0.01f + lo_cut * 0.45f;
                const float hp = hp_c * (prev_out + tap - prev_in);
                prev_in = tap;
                prev_out = hp;
                const float lp_c = 0.01f + (1.0f - hi_cut) * 0.45f;
                lp_z += lp_c * (hp - lp_z);
                const float wet = lp_z;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX13 resonator */
            if (on[12]) {
                const float tone = mix_params[12][0];
                const float res = 0.3f + mix_params[12][1] * 0.68f;
                const float mix = mix_params[12][2];
                const float drive = 1.0f + mix_params[12][3] * 8.0f;
                const float keytrk = mix_params[12][4];
                const float spread = (mix_params[12][5] - 0.5f) * 0.2f;
                const float lo = mix_params[12][6];
                const float hi = mix_params[12][7];
                float f = 0.01f + tone * 0.45f + keytrk * fabsf(x) * 0.18f;
                f += (ch == 0) ? -spread : spread;
                f = clampf(f, 0.005f, 0.95f);
                const float in = tanhf(x * drive);
                lp_z += f * (in - lp_z);
                float wet = in * (1.0f - res) + lp_z * res;
                wet += (lo - 0.5f) * lp_z * 0.25f;
                wet += (hi - 0.5f) * (in - lp_z) * 0.25f;
                x = in * (1.0f - mix) + wet * mix;
            }
            /* FX14 phaser */
            if (on[13]) {
                const float rate = 0.05f + mix_params[13][0] * 1.8f;
                const float depth = mix_params[13][1] * 0.9f;
                const float mix = mix_params[13][2];
                const float feedback = (mix_params[13][3] - 0.5f) * 0.7f;
                const float color = mix_params[13][4];
                const float stereo = (mix_params[13][5] - 0.5f) * 0.6f;
                const float phase_ofs = mix_params[13][6] * 2.0f * (float)M_PI;
                const float out = 0.35f + mix_params[13][7] * 1.65f;
                const float phase = sinf((((float)dpos * rate) / (float)sr) * 2.0f * (float)M_PI + phase_ofs + ((ch == 0) ? -stereo : stereo));
                const float allp = x - depth * phase * prev_out;
                const float wet = allp * (0.4f + color * 0.6f) + x * (0.6f - color * 0.2f);
                prev_out = wet + prev_out * feedback * 0.35f;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX15 lofi wash */
            if (on[14]) {
                const float noise = (mix_params[14][0] - 0.5f) * 0.08f;
                const float blur = 0.01f + mix_params[14][1] * 0.2f;
                const float mix = mix_params[14][2];
                const float age = mix_params[14][3];
                const float tone = (mix_params[14][4] - 0.5f) * 0.8f;
                const float lo_cut = mix_params[14][5];
                const float hi_cut = mix_params[14][6];
                const float out = 0.35f + mix_params[14][7] * 1.65f;
                lp_z += blur * (x - lp_z);
                float crackle = noise * sinf((float)(dpos * 97 + ch * 53));
                if (fabsf(sinf((float)(dpos + ch * 17) * (0.007f + age * 0.08f))) < age * 0.12f) crackle *= 2.0f;
                float wet = lp_z + crackle;
                wet += tone * (wet - x) * 0.25f;
                const float hp_c = 0.01f + lo_cut * 0.45f;
                const float hp = hp_c * (prev_out + wet - prev_in);
                prev_in = wet;
                prev_out = hp;
                const float lp_c = 0.01f + (1.0f - hi_cut) * 0.45f;
                lp_z += lp_c * (hp - lp_z);
                wet = lp_z;
                x = (x * (1.0f - mix) + wet * mix) * out;
            }
            /* FX16 ducker */
            if (on[15]) {
                const float depth = mix_params[15][0] * 0.9f;
                const float release = 0.0005f + mix_params[15][1] * 0.03f;
                const float mix = mix_params[15][2];
                const float attack = 0.0005f + mix_params[15][3] * 0.03f;
                const float hold = mix_params[15][4];
                const float tone = (mix_params[15][5] - 0.5f) * 0.8f;
                const float stereo = (mix_params[15][6] - 0.5f) * 0.3f;
                const float out = 0.35f + mix_params[15][7] * 1.65f;
                const float env = fabsf(x) * (1.0f + hold * 1.5f);
                if (env > inst->pfx_duck_env) inst->pfx_duck_env += (env - inst->pfx_duck_env) * attack;
                else inst->pfx_duck_env += (env - inst->pfx_duck_env) * release;
                float duck = 1.0f - depth * clampf(inst->pfx_duck_env, 0.0f, 1.0f);
                duck += (ch == 0) ? (-stereo * 0.1f) : (stereo * 0.1f);
                duck = clampf(duck, 0.05f, 1.2f);
                float wet = x * duck;
                wet += tone * (wet - x) * 0.25f;
                x = (x * (1.0f - mix) + wet * mix) * out;
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
