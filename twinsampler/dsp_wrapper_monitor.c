#define _GNU_SOURCE

#include <dlfcn.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "plugin_api_v1.h"

typedef struct wrapper_instance {
    void *core_handle;
    plugin_api_v2_t *core_api_v2;
    void *core_instance;
    int monitor_enabled;
    float monitor_gain;
    int record_mix_schwung;
    float record_mix_gain;
    int recording_cached;
    int16_t *input_backup;
    int16_t *input_mix;
    int scratch_samples;
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

static int parse_bool(const char *val) {
    if (!val) return 0;
    if (!strcmp(val, "1")) return 1;
    if (!strcmp(val, "true")) return 1;
    if (!strcmp(val, "on")) return 1;
    return 0;
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

static void* wrapper_create_instance(const char *module_dir, const char *json_defaults) {
    wrapper_instance_t *inst = (wrapper_instance_t *)calloc(1, sizeof(wrapper_instance_t));
    if (!inst) return NULL;

    inst->monitor_enabled = 0;
    inst->monitor_gain = 1.0f;
    inst->record_mix_schwung = 1;
    inst->record_mix_gain = 1.0f;
    inst->recording_cached = 0;
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

static void wrapper_render_block(void *instance, int16_t *out_interleaved_lr, int frames) {
    wrapper_instance_t *inst = (wrapper_instance_t *)instance;
    if (!inst || !out_interleaved_lr || frames <= 0) return;

    const int total = frames * 2;
    int input_replaced = 0;
    int16_t *audio_in_rw = NULL;

    if (g_host && g_host->mapped_memory &&
        inst->record_mix_schwung &&
        inst->input_backup &&
        inst->input_mix &&
        total <= inst->scratch_samples &&
        g_host->audio_in_offset > 0 &&
        g_host->audio_out_offset > 0 &&
        core_is_recording(inst)) {
        audio_in_rw = (int16_t *)(g_host->mapped_memory + g_host->audio_in_offset);
        const int16_t *schwung_bus = (const int16_t *)(g_host->mapped_memory + g_host->audio_out_offset);
        if (audio_in_rw && schwung_bus) {
            memcpy(inst->input_backup, audio_in_rw, (size_t)total * sizeof(int16_t));
            const float rec_gain = inst->record_mix_gain;
            for (int i = 0; i < total; i++) {
                const int32_t rec_mix = (int32_t)((float)schwung_bus[i] * rec_gain);
                inst->input_mix[i] = (int16_t)clip_i32_to_i16(rec_mix);
            }
            memcpy(audio_in_rw, inst->input_mix, (size_t)total * sizeof(int16_t));
            input_replaced = 1;
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

    if (g_host->audio_in_offset <= 0) return;
    const int16_t *audio_in = (const int16_t *)(g_host->mapped_memory + g_host->audio_in_offset);
    if (!audio_in) return;

    const float gain = inst->monitor_gain;
    for (int i = 0; i < total; i++) {
        const int32_t mon = (int32_t)((float)audio_in[i] * gain);
        const int32_t sum = (int32_t)out_interleaved_lr[i] + mon;
        out_interleaved_lr[i] = (int16_t)clip_i32_to_i16(sum);
    }
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
