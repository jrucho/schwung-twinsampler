#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "dsp_core_blob.h"
#include "plugin_api_v1.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define TS_SLOT_PATH_MAX 4096

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
    int16_t *last_output;
    int scratch_samples;
    int capture_source_last; /* 0=none 1=input 2=bus 3=mix */
    float input_peak_last;
    float bus_peak_last;
    float internal_peak_last;
    int debug_capture_logs;
    int debug_sample_loads;
    int sample_fallback_count;
    char last_sample_diag[512];
    int input_active_prev;
    int bus_active_prev;
    int auto_hold_blocks;
    uint32_t dither_state;
    int current_bank[2];
    int edit_section;
    int edit_bank;
    int edit_slot;
    int slot_reverse[2][8][16];
    char slot_sample_path[2][8][16][TS_SLOT_PATH_MAX];
    int pfx_active_section;
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
    float pfx_fx_lp_z[16][2];
    float pfx_fx_bp_z[16][2];
    float pfx_fx_hp_prev_in[16][2];
    float pfx_fx_hp_prev_out[16][2];
    float pfx_fx_env[16][2];
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
    float *pfx_djfx_buf;
    int pfx_djfx_buf_len;
    int pfx_djfx_active;
    int pfx_djfx_len;
    float pfx_djfx_pos;
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

static int clampi(int v, int lo, int hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static float pfx_softclip(float x) {
    return tanhf(x);
}

static float pfx_xfade(float dry, float wet, float mix) {
    const float m = clampf(mix, 0.0f, 1.0f);
    return dry * (1.0f - m) + wet * m;
}

static float pfx_onepole_lp(float *z, float x, float coeff) {
    const float c = clampf(coeff, 0.0005f, 0.98f);
    *z += c * (x - *z);
    return *z;
}

static float pfx_onepole_hp(float *prev_in, float *prev_out, float x, float coeff) {
    const float c = clampf(coeff, 0.0005f, 0.98f);
    const float y = c * (*prev_out + x - *prev_in);
    *prev_in = x;
    *prev_out = y;
    return y;
}

static uint32_t xorshift32(uint32_t *state) {
    uint32_t x = (*state) ? (*state) : 0x12345678u;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    return x;
}

static float pfx_noise_from_u32(uint32_t *state, float amount) {
    return ((float)(xorshift32(state) & 0xffffu) / 32767.5f - 1.0f) * amount;
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

/* TwinSampler UI exposes the SP-404-style performance FX slots directly. */
static int is_active_ui_fx_index(int fx_idx) {
    return fx_idx >= 0 && fx_idx < 9;
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

static int parse_prefixed_int_payload(const char *val, int *out, int count, const char **payload) {
    if (!val || !out || count <= 0 || !payload) return 0;
    const char *p = val;
    for (int i = 0; i < count; i++) {
        char *end = NULL;
        long v = strtol(p, &end, 10);
        if (end == p || *end != ':') return 0;
        out[i] = (int)v;
        p = end + 1;
    }
    if (!*p) return 0;
    *payload = p;
    return 1;
}

static float parse_colon_float_tail(const char *val, float fallback) {
    if (!val) return fallback;
    const char *last = strrchr(val, ':');
    const char *num = last ? (last + 1) : val;
    return parse_float_clamped(num, -16.0f, 16.0f, fallback);
}

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define TS_SAMPLE_CACHE_DIR "/tmp/twinsampler_sample_cache"
#define TS_SAMPLE_PARAM_BUF (PATH_MAX + 128)
#define WAV_FORMAT_PCM 1
#define WAV_FORMAT_IEEE_FLOAT 3
#define WAV_FORMAT_EXTENSIBLE 0xfffe

typedef struct wav_info {
    int valid;
    int unsupported;
    int has_extra_chunks;
    uint16_t original_format;
    uint16_t audio_format;
    uint16_t channels;
    uint32_t sample_rate;
    uint16_t block_align;
    uint16_t bits_per_sample;
    long data_offset;
    uint32_t data_size;
    char reason[160];
} wav_info_t;

static void set_sample_diag(wrapper_instance_t *inst, const char *fmt, ...) {
    if (!inst || !fmt) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(inst->last_sample_diag, sizeof(inst->last_sample_diag), fmt, ap);
    va_end(ap);
}

static void log_sample_diag(wrapper_instance_t *inst, const char *fmt, ...) {
    if (!inst || !fmt) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(inst->last_sample_diag, sizeof(inst->last_sample_diag), fmt, ap);
    va_end(ap);
    log_msg(inst->last_sample_diag);
}

static int ascii_eq_ci(char a, char b) {
    if (a >= 'A' && a <= 'Z') a = (char)(a + ('a' - 'A'));
    if (b >= 'A' && b <= 'Z') b = (char)(b + ('a' - 'A'));
    return a == b;
}

static int path_has_wav_ext(const char *path) {
    if (!path) return 0;
    const size_t len = strlen(path);
    if (len < 4) return 0;
    const char *ext = path + len - 4;
    return ascii_eq_ci(ext[0], '.') && ascii_eq_ci(ext[1], 'w') &&
        ascii_eq_ci(ext[2], 'a') && ascii_eq_ci(ext[3], 'v');
}

static const char *base_name_c(const char *path) {
    if (!path) return "";
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

static uint16_t rd_u16_le(const uint8_t *p) {
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t rd_u32_le(const uint8_t *p) {
    return (uint32_t)p[0] |
        ((uint32_t)p[1] << 8) |
        ((uint32_t)p[2] << 16) |
        ((uint32_t)p[3] << 24);
}

static void wr_u16_le(uint8_t *p, uint16_t v) {
    p[0] = (uint8_t)(v & 0xffu);
    p[1] = (uint8_t)((v >> 8) & 0xffu);
}

static void wr_u32_le(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)(v & 0xffu);
    p[1] = (uint8_t)((v >> 8) & 0xffu);
    p[2] = (uint8_t)((v >> 16) & 0xffu);
    p[3] = (uint8_t)((v >> 24) & 0xffu);
}

static int read_exact(FILE *f, void *buf, size_t len) {
    return f && buf && fread(buf, 1, len, f) == len;
}

static void wav_reason_append(wav_info_t *info, const char *reason) {
    if (!info || !reason || !reason[0]) return;
    const size_t cur = strlen(info->reason);
    if (cur >= sizeof(info->reason) - 1) return;
    snprintf(info->reason + cur, sizeof(info->reason) - cur, "%s%s", cur ? ", " : "", reason);
}

static int inspect_wav_file(const char *path, wav_info_t *info) {
    if (!info) return 0;
    memset(info, 0, sizeof(*info));
    if (!path || !path[0]) {
        snprintf(info->reason, sizeof(info->reason), "empty path");
        return 0;
    }

    FILE *f = fopen(path, "rb");
    if (!f) {
        snprintf(info->reason, sizeof(info->reason), "open failed errno=%d", errno);
        return 0;
    }

    uint8_t hdr[12];
    if (!read_exact(f, hdr, sizeof(hdr)) ||
        memcmp(hdr, "RIFF", 4) ||
        memcmp(hdr + 8, "WAVE", 4)) {
        snprintf(info->reason, sizeof(info->reason), "not RIFF/WAVE");
        fclose(f);
        return 0;
    }

    int saw_fmt = 0;
    int saw_data = 0;
    int first_chunk = 1;
    long expected_simple_data_offset = 44;
    while (1) {
        uint8_t chdr[8];
        const long chunk_header_pos = ftell(f);
        if (chunk_header_pos < 0) break;
        if (!read_exact(f, chdr, sizeof(chdr))) break;
        const uint32_t size = rd_u32_le(chdr + 4);
        const long payload_pos = ftell(f);
        if (payload_pos < 0) break;

        if (memcmp(chdr, "fmt ", 4) == 0) {
            uint8_t fmt[64];
            const size_t to_read = size < sizeof(fmt) ? (size_t)size : sizeof(fmt);
            if (size < 16 || !read_exact(f, fmt, to_read)) {
                snprintf(info->reason, sizeof(info->reason), "bad fmt chunk");
                fclose(f);
                return 0;
            }
            info->original_format = rd_u16_le(fmt);
            info->audio_format = info->original_format;
            info->channels = rd_u16_le(fmt + 2);
            info->sample_rate = rd_u32_le(fmt + 4);
            info->block_align = rd_u16_le(fmt + 12);
            info->bits_per_sample = rd_u16_le(fmt + 14);
            if (info->original_format == WAV_FORMAT_EXTENSIBLE && size >= 40 && to_read >= 40) {
                info->audio_format = rd_u16_le(fmt + 24);
                wav_reason_append(info, "extensible fmt");
            }
            if (size != 16) wav_reason_append(info, "extended fmt chunk");
            if (!first_chunk || chunk_header_pos != 12) info->has_extra_chunks = 1;
            saw_fmt = 1;
        } else if (memcmp(chdr, "data", 4) == 0) {
            info->data_offset = payload_pos;
            info->data_size = size;
            if (!saw_fmt) info->has_extra_chunks = 1;
            if (payload_pos != expected_simple_data_offset) info->has_extra_chunks = 1;
            saw_data = 1;
        } else {
            info->has_extra_chunks = 1;
        }

        if (fseek(f, payload_pos + (long)size + (long)(size & 1u), SEEK_SET) != 0) break;
        first_chunk = 0;
        if (saw_fmt && saw_data) break;
    }
    fclose(f);

    if (!saw_fmt) {
        snprintf(info->reason, sizeof(info->reason), "missing fmt chunk");
        return 0;
    }
    if (!saw_data || info->data_size == 0) {
        snprintf(info->reason, sizeof(info->reason), "missing/empty data chunk");
        return 0;
    }
    if (info->channels < 1 || info->channels > 16) {
        snprintf(info->reason, sizeof(info->reason), "unsupported channel count %u", (unsigned)info->channels);
        info->unsupported = 1;
        return 0;
    }
    if (!info->block_align) {
        snprintf(info->reason, sizeof(info->reason), "invalid block align");
        info->unsupported = 1;
        return 0;
    }
    if (info->sample_rate == 0) {
        snprintf(info->reason, sizeof(info->reason), "invalid sample rate");
        info->unsupported = 1;
        return 0;
    }
    if (info->audio_format == WAV_FORMAT_PCM) {
        if (info->bits_per_sample != 8 && info->bits_per_sample != 16 &&
            info->bits_per_sample != 24 && info->bits_per_sample != 32) {
            snprintf(info->reason, sizeof(info->reason), "unsupported PCM bits %u", (unsigned)info->bits_per_sample);
            info->unsupported = 1;
            return 0;
        }
    } else if (info->audio_format == WAV_FORMAT_IEEE_FLOAT) {
        if (info->bits_per_sample != 32) {
            snprintf(info->reason, sizeof(info->reason), "unsupported float bits %u", (unsigned)info->bits_per_sample);
            info->unsupported = 1;
            return 0;
        }
    } else {
        snprintf(info->reason, sizeof(info->reason), "unsupported WAV format %u", (unsigned)info->original_format);
        info->unsupported = 1;
        return 0;
    }

    if (info->audio_format != WAV_FORMAT_PCM) wav_reason_append(info, "float samples");
    if (info->bits_per_sample != 16) wav_reason_append(info, "non-16-bit samples");
    if (info->channels > 2) wav_reason_append(info, "multichannel");
    if (info->has_extra_chunks) wav_reason_append(info, "metadata/noncanonical chunks");
    if (!info->reason[0]) snprintf(info->reason, sizeof(info->reason), "simple PCM16");
    info->valid = 1;
    return 1;
}

static uint32_t core_playback_sample_rate(void) {
    const int sr = (g_host && g_host->sample_rate > 1000) ? g_host->sample_rate : MOVE_SAMPLE_RATE;
    return (uint32_t)((sr > 1000) ? sr : MOVE_SAMPLE_RATE);
}

static int wav_is_simple_core_format(const wav_info_t *info, uint32_t target_sample_rate) {
    return info && info->valid &&
        info->original_format == WAV_FORMAT_PCM &&
        info->audio_format == WAV_FORMAT_PCM &&
        info->channels >= 1 && info->channels <= 2 &&
        info->bits_per_sample == 16 &&
        info->sample_rate == target_sample_rate &&
        !info->has_extra_chunks &&
        info->data_offset == 44;
}

static uint64_t fnv1a64_bytes(uint64_t h, const void *data, size_t len) {
    const uint8_t *p = (const uint8_t *)data;
    for (size_t i = 0; i < len; i++) {
        h ^= (uint64_t)p[i];
        h *= 1099511628211ull;
    }
    return h;
}

static uint64_t sample_cache_hash(const char *path, const wav_info_t *info, uint32_t target_sample_rate, int reverse) {
    uint64_t h = 1469598103934665603ull;
    if (path) h = fnv1a64_bytes(h, path, strlen(path));
    struct stat st;
    if (path && stat(path, &st) == 0) {
        h = fnv1a64_bytes(h, &st.st_size, sizeof(st.st_size));
        h = fnv1a64_bytes(h, &st.st_mtime, sizeof(st.st_mtime));
    }
    if (info) {
        h = fnv1a64_bytes(h, &info->data_size, sizeof(info->data_size));
        h = fnv1a64_bytes(h, &info->audio_format, sizeof(info->audio_format));
        h = fnv1a64_bytes(h, &info->channels, sizeof(info->channels));
        h = fnv1a64_bytes(h, &info->bits_per_sample, sizeof(info->bits_per_sample));
    }
    h = fnv1a64_bytes(h, &target_sample_rate, sizeof(target_sample_rate));
    uint8_t reverse_flag = reverse ? 1u : 0u;
    h = fnv1a64_bytes(h, &reverse_flag, sizeof(reverse_flag));
    return h;
}

static int ensure_sample_cache_dir(void) {
    if (mkdir(TS_SAMPLE_CACHE_DIR, 0755) == 0) return 1;
    if (errno == EEXIST) return 1;
    return 0;
}

static float decode_wav_sample(const uint8_t *p, const wav_info_t *info) {
    if (!p || !info) return 0.0f;
    if (info->audio_format == WAV_FORMAT_IEEE_FLOAT && info->bits_per_sample == 32) {
        uint32_t u = rd_u32_le(p);
        float f = 0.0f;
        memcpy(&f, &u, sizeof(f));
        return clampf(f, -1.0f, 1.0f);
    }
    if (info->audio_format != WAV_FORMAT_PCM) return 0.0f;
    if (info->bits_per_sample == 8) {
        return ((float)p[0] - 128.0f) / 128.0f;
    }
    if (info->bits_per_sample == 16) {
        int16_t v = (int16_t)rd_u16_le(p);
        return (float)v / 32768.0f;
    }
    if (info->bits_per_sample == 24) {
        int32_t v = (int32_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16));
        if (v & 0x00800000) v |= (int32_t)0xff000000;
        return (float)v / 8388608.0f;
    }
    if (info->bits_per_sample == 32) {
        int32_t v = (int32_t)rd_u32_le(p);
        return (float)((double)v / 2147483648.0);
    }
    return 0.0f;
}

static void encode_i16(uint8_t *p, float x) {
    const float c = clampf(x, -1.0f, 1.0f);
    int32_t v = (int32_t)lrintf(c * 32767.0f);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    wr_u16_le(p, (uint16_t)(int16_t)v);
}

static int write_wav_header(FILE *out, uint16_t channels, uint32_t sample_rate, uint32_t data_bytes) {
    uint8_t h[44];
    memset(h, 0, sizeof(h));
    memcpy(h, "RIFF", 4);
    wr_u32_le(h + 4, 36u + data_bytes);
    memcpy(h + 8, "WAVE", 4);
    memcpy(h + 12, "fmt ", 4);
    wr_u32_le(h + 16, 16);
    wr_u16_le(h + 20, WAV_FORMAT_PCM);
    wr_u16_le(h + 22, channels);
    wr_u32_le(h + 24, sample_rate);
    wr_u32_le(h + 28, sample_rate * (uint32_t)channels * 2u);
    wr_u16_le(h + 32, (uint16_t)(channels * 2u));
    wr_u16_le(h + 34, 16);
    memcpy(h + 36, "data", 4);
    wr_u32_le(h + 40, data_bytes);
    return fwrite(h, 1, sizeof(h), out) == sizeof(h);
}

static int read_decoded_frame(FILE *in, const wav_info_t *info, uint8_t *frame_buf, uint16_t out_channels, float *left, float *right) {
    if (!in || !info || !frame_buf || !left || !right) return 0;
    if (fread(frame_buf, 1, (size_t)info->block_align, in) != (size_t)info->block_align) return 0;

    const size_t bytes_per_sample = (size_t)((info->bits_per_sample + 7u) / 8u);
    float l = 0.0f;
    float r = 0.0f;
    int lc = 0;
    int rc = 0;
    for (uint16_t ch = 0; ch < info->channels; ch++) {
        const size_t off = (size_t)ch * bytes_per_sample;
        if (off + bytes_per_sample > (size_t)info->block_align) continue;
        const float x = decode_wav_sample(frame_buf + off, info);
        if (out_channels == 1) {
            l += x;
            lc++;
        } else if ((ch & 1u) == 0) {
            l += x;
            lc++;
        } else {
            r += x;
            rc++;
        }
    }

    if (lc > 0) l /= (float)lc;
    if (out_channels == 1) r = l;
    else if (rc > 0) r /= (float)rc;
    else r = l;

    *left = l;
    *right = r;
    return 1;
}

static int read_decoded_frame_at(FILE *in,
                                 const wav_info_t *info,
                                 uint8_t *frame_buf,
                                 uint16_t out_channels,
                                 uint64_t frame_idx,
                                 float *left,
                                 float *right) {
    if (!in || !info || !frame_buf) return 0;
    const uint64_t byte_off = (uint64_t)info->data_offset + frame_idx * (uint64_t)info->block_align;
    if (fseeko(in, (off_t)byte_off, SEEK_SET) != 0) return 0;
    return read_decoded_frame(in, info, frame_buf, out_channels, left, right);
}

static int convert_wav_to_core_pcm16(const char *src_path,
                                     const wav_info_t *info,
                                     uint32_t target_sample_rate,
                                     int reverse,
                                     char *out_path,
                                     size_t out_len) {
    if (!src_path || !info || !info->valid || !out_path || out_len == 0) return 0;
    if (!ensure_sample_cache_dir()) return 0;
    if (target_sample_rate < 1000) target_sample_rate = MOVE_SAMPLE_RATE;

    const uint16_t out_channels = info->channels == 1 ? 1 : 2;
    const uint64_t src_frames = info->data_size / info->block_align;
    const uint64_t out_frames = (src_frames * (uint64_t)target_sample_rate + (uint64_t)(info->sample_rate / 2u)) /
        (uint64_t)info->sample_rate;
    const uint64_t out_data_bytes64 = out_frames * (uint64_t)out_channels * 2ull;
    if (src_frames == 0 || out_frames == 0 || out_data_bytes64 > 0xffffffffull) return 0;
    const uint32_t out_data_bytes = (uint32_t)out_data_bytes64;

    const uint64_t hash = sample_cache_hash(src_path, info, target_sample_rate, reverse);
    if (snprintf(out_path, out_len, "%s/%016llx.wav", TS_SAMPLE_CACHE_DIR, (unsigned long long)hash) >= (int)out_len) {
        return 0;
    }
    struct stat st;
    if (stat(out_path, &st) == 0 && st.st_size == (off_t)(44u + out_data_bytes)) return 1;

    char tmp_path[PATH_MAX];
    if (snprintf(tmp_path, sizeof(tmp_path), "%s.tmp.%ld", out_path, (long)getpid()) >= (int)sizeof(tmp_path)) return 0;

    FILE *in = fopen(src_path, "rb");
    if (!in) return 0;
    FILE *out = fopen(tmp_path, "wb");
    if (!out) {
        fclose(in);
        return 0;
    }
    if (fseek(in, info->data_offset, SEEK_SET) != 0 ||
        !write_wav_header(out, out_channels, target_sample_rate, out_data_bytes)) {
        fclose(in);
        fclose(out);
        unlink(tmp_path);
        return 0;
    }

    uint8_t *frame_buf = (uint8_t *)malloc((size_t)info->block_align);
    uint8_t out_frame[4];
    if (!frame_buf) {
        fclose(in);
        fclose(out);
        unlink(tmp_path);
        return 0;
    }

    int ok = 1;
    if (!reverse) {
        uint64_t cur_idx = 0;
        float cur_l = 0.0f, cur_r = 0.0f;
        float next_l = 0.0f, next_r = 0.0f;
        if (!read_decoded_frame(in, info, frame_buf, out_channels, &cur_l, &cur_r)) ok = 0;
        if (ok) {
            if (src_frames > 1) {
                if (!read_decoded_frame(in, info, frame_buf, out_channels, &next_l, &next_r)) ok = 0;
            } else {
                next_l = cur_l;
                next_r = cur_r;
            }
        }

        for (uint64_t out_idx = 0; ok && out_idx < out_frames; out_idx++) {
            const double src_pos = ((double)out_idx * (double)info->sample_rate) / (double)target_sample_rate;
            uint64_t want_idx = (uint64_t)src_pos;
            if (want_idx >= src_frames) want_idx = src_frames - 1;

            while (cur_idx < want_idx) {
                cur_l = next_l;
                cur_r = next_r;
                cur_idx++;
                if (cur_idx + 1 < src_frames) {
                    if (!read_decoded_frame(in, info, frame_buf, out_channels, &next_l, &next_r)) {
                        ok = 0;
                        break;
                    }
                } else {
                    next_l = cur_l;
                    next_r = cur_r;
                }
            }
            if (!ok) break;

            const float frac = clampf((float)(src_pos - (double)want_idx), 0.0f, 1.0f);
            const float l = cur_l + (next_l - cur_l) * frac;
            const float r = cur_r + (next_r - cur_r) * frac;
            encode_i16(out_frame, l);
            if (out_channels == 1) {
                if (fwrite(out_frame, 1, 2, out) != 2) ok = 0;
            } else {
                encode_i16(out_frame + 2, r);
                if (fwrite(out_frame, 1, 4, out) != 4) ok = 0;
            }
        }
    } else {
        for (uint64_t out_idx = 0; ok && out_idx < out_frames; out_idx++) {
            double src_pos = (double)(src_frames - 1u) -
                (((double)out_idx * (double)info->sample_rate) / (double)target_sample_rate);
            if (src_pos < 0.0) src_pos = 0.0;
            const double max_pos = (double)(src_frames - 1u);
            if (src_pos > max_pos) src_pos = max_pos;

            uint64_t idx0 = (uint64_t)src_pos;
            if (idx0 >= src_frames) idx0 = src_frames - 1u;
            uint64_t idx1 = idx0 + 1u;
            if (idx1 >= src_frames) idx1 = idx0;

            float l0 = 0.0f, r0 = 0.0f, l1 = 0.0f, r1 = 0.0f;
            if (!read_decoded_frame_at(in, info, frame_buf, out_channels, idx0, &l0, &r0) ||
                !read_decoded_frame_at(in, info, frame_buf, out_channels, idx1, &l1, &r1)) {
                ok = 0;
                break;
            }

            const float frac = clampf((float)(src_pos - (double)idx0), 0.0f, 1.0f);
            const float l = l0 + (l1 - l0) * frac;
            const float r = r0 + (r1 - r0) * frac;
            encode_i16(out_frame, l);
            if (out_channels == 1) {
                if (fwrite(out_frame, 1, 2, out) != 2) ok = 0;
            } else {
                encode_i16(out_frame + 2, r);
                if (fwrite(out_frame, 1, 4, out) != 4) ok = 0;
            }
        }
    }

    free(frame_buf);
    if (fclose(out) != 0) ok = 0;
    fclose(in);
    if (!ok) {
        unlink(tmp_path);
        return 0;
    }
    if (rename(tmp_path, out_path) != 0) {
        unlink(tmp_path);
        return stat(out_path, &st) == 0 && st.st_size == (off_t)(44u + out_data_bytes);
    }
    return 1;
}

static int maybe_rewrite_sample_path(wrapper_instance_t *inst, const char *path, char *out_path, size_t out_len, int reverse) {
    if (!path || !path[0] || !out_path || out_len == 0 || !path_has_wav_ext(path)) return 0;

    wav_info_t info;
    if (!inspect_wav_file(path, &info)) {
        if (inst && (inst->debug_sample_loads || info.unsupported)) {
            log_sample_diag(inst, "TwinSampler sample load: forwarding original %s (%s)",
                base_name_c(path), info.reason[0] ? info.reason : "inspect failed");
        } else {
            set_sample_diag(inst, "TwinSampler sample load: %s (%s)",
                base_name_c(path), info.reason[0] ? info.reason : "inspect failed");
        }
        return 0;
    }
    const uint32_t target_sample_rate = core_playback_sample_rate();
    if (info.sample_rate != target_sample_rate) {
        char sr_reason[64];
        snprintf(sr_reason, sizeof(sr_reason), "resample %u->%u",
            (unsigned)info.sample_rate, (unsigned)target_sample_rate);
        wav_reason_append(&info, sr_reason);
    }
    if (reverse) wav_reason_append(&info, "reverse");

    if (!reverse && wav_is_simple_core_format(&info, target_sample_rate)) {
        if (inst && inst->debug_sample_loads) {
            log_sample_diag(inst, "TwinSampler sample load: simple PCM16 %s", base_name_c(path));
        } else {
            set_sample_diag(inst, "TwinSampler sample load: simple PCM16 %s", base_name_c(path));
        }
        return 0;
    }
    if (!convert_wav_to_core_pcm16(path, &info, target_sample_rate, reverse, out_path, out_len)) {
        log_sample_diag(inst, "TwinSampler sample load: conversion failed for %s (%s)",
            base_name_c(path), info.reason[0] ? info.reason : "noncanonical WAV");
        return 0;
    }

    if (inst) inst->sample_fallback_count++;
    log_sample_diag(inst, "TwinSampler sample load: converted %s -> %s (%s)",
        base_name_c(path), base_name_c(out_path), info.reason[0] ? info.reason : "noncanonical WAV");
    return 1;
}

static int parse_slot_sample_value(const char *val, int *sec, int *bank, int *slot, const char **path) {
    int parts[3] = {0};
    const char *payload = NULL;
    if (!parse_prefixed_int_payload(val, parts, 3, &payload)) return 0;
    if (sec) *sec = clampi(parts[0], 0, 1);
    if (bank) *bank = clampi(parts[1], 0, 7);
    if (slot) *slot = clampi(parts[2], 0, 15);
    if (path) *path = payload;
    return 1;
}

static int build_slot_sample_value(wrapper_instance_t *inst,
                                   int sec,
                                   int bank,
                                   int slot,
                                   const char *path,
                                   char *out,
                                   size_t out_len) {
    if (!inst || !path || !path[0] || !out || out_len == 0) return 0;
    sec = clampi(sec, 0, 1);
    bank = clampi(bank, 0, 7);
    slot = clampi(slot, 0, 15);

    const char *send_path = path;
    char rewritten[PATH_MAX];
    if (maybe_rewrite_sample_path(inst, path, rewritten, sizeof(rewritten), inst->slot_reverse[sec][bank][slot])) {
        send_path = rewritten;
    }

    const int n = snprintf(out, out_len, "%d:%d:%d:%s", sec, bank, slot, send_path);
    return n > 0 && n < (int)out_len;
}

static int rewrite_slot_sample_payload(wrapper_instance_t *inst, const char *val, char *out, size_t out_len) {
    int sec = 0;
    int bank = 0;
    int slot = 0;
    const char *path = NULL;
    if (!parse_slot_sample_value(val, &sec, &bank, &slot, &path)) return 0;
    return build_slot_sample_value(inst, sec, bank, slot, path, out, out_len);
}

static void remember_slot_sample_path(wrapper_instance_t *inst, const char *val) {
    int sec = 0;
    int bank = 0;
    int slot = 0;
    const char *path = NULL;
    if (!inst || !parse_slot_sample_value(val, &sec, &bank, &slot, &path)) return;
    snprintf(inst->slot_sample_path[sec][bank][slot], sizeof(inst->slot_sample_path[sec][bank][slot]), "%s", path);
}

static void clear_slot_sample_path_state(wrapper_instance_t *inst, const char *val) {
    if (!inst) return;
    int parts[3] = {0};
    if (parse_colon_ints(val, parts, 3) < 3) return;
    const int sec = clampi(parts[0], 0, 1);
    const int bank = clampi(parts[1], 0, 7);
    const int slot = clampi(parts[2], 0, 15);
    inst->slot_sample_path[sec][bank][slot][0] = '\0';
}

static void reload_slot_sample_for_reverse(wrapper_instance_t *inst, int sec, int bank, int slot) {
    if (!inst || !inst->core_api_v2 || !inst->core_api_v2->set_param || !inst->core_instance) return;
    sec = clampi(sec, 0, 1);
    bank = clampi(bank, 0, 7);
    slot = clampi(slot, 0, 15);
    const char *path = inst->slot_sample_path[sec][bank][slot];
    if (!path[0]) return;

    char value[TS_SAMPLE_PARAM_BUF];
    if (!build_slot_sample_value(inst, sec, bank, slot, path, value, sizeof(value))) return;
    inst->core_api_v2->set_param(inst->core_instance, "slot_sample_path", value);
}

static int rewrite_prefixed_sample_payload(wrapper_instance_t *inst,
                                           const char *val,
                                           int prefix_colons,
                                           char *out,
                                           size_t out_len) {
    if (!val || !out || out_len == 0 || prefix_colons < 0) return 0;
    const char *p = val;
    int colons = 0;
    while (*p && colons < prefix_colons) {
        if (*p == ':') colons++;
        p++;
    }
    if (colons < prefix_colons || !*p) return 0;

    char rewritten[PATH_MAX];
    if (!maybe_rewrite_sample_path(inst, p, rewritten, sizeof(rewritten), 0)) return 0;

    const size_t prefix_len = (size_t)(p - val);
    if (prefix_len + strlen(rewritten) + 1 > out_len) return 0;
    memcpy(out, val, prefix_len);
    strcpy(out + prefix_len, rewritten);
    return 1;
}

static int rewrite_sample_param_value(wrapper_instance_t *inst,
                                      const char *key,
                                      const char *val,
                                      char *out,
                                      size_t out_len) {
    if (!key || !val || !out || out_len == 0) return 0;
    if (!strcmp(key, "slot_sample_path")) {
        return rewrite_slot_sample_payload(inst, val, out, out_len);
    }
    if (!strcmp(key, "section_source_path")) {
        return rewrite_prefixed_sample_payload(inst, val, 2, out, out_len);
    }
    if (!strcmp(key, "sample_path")) {
        char rewritten[PATH_MAX];
        if (!maybe_rewrite_sample_path(inst, val, rewritten, sizeof(rewritten), 0)) return 0;
        if (strlen(rewritten) + 1 > out_len) return 0;
        strcpy(out, rewritten);
        return 1;
    }
    return 0;
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
    inst->internal_peak_last = 0.0f;
    inst->debug_capture_logs = 0;
    inst->debug_sample_loads = 0;
    inst->sample_fallback_count = 0;
    inst->last_sample_diag[0] = '\0';
    inst->input_active_prev = 0;
    inst->bus_active_prev = 0;
    inst->auto_hold_blocks = 0;
    inst->dither_state = 0x6d2b79f5u;
    inst->current_bank[0] = 0;
    inst->current_bank[1] = 0;
    inst->pfx_active_section = 0;
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
    inst->pfx_djfx_buf_len = sr / 2;
    if (inst->pfx_djfx_buf_len < 4096) inst->pfx_djfx_buf_len = 4096;
    inst->pfx_djfx_active = 0;
    inst->pfx_djfx_len = 1;
    inst->pfx_djfx_pos = 0.0f;
    inst->pfx_djfx_buf = (float *)calloc((size_t)inst->pfx_djfx_buf_len * 2u, sizeof(float));
    inst->pfx_delay_len = sr * 2;
    inst->pfx_delay_pos = 0;
    inst->pfx_delay_buf = (float *)calloc((size_t)inst->pfx_delay_len * 2u, sizeof(float));
    inst->scratch_samples = ((g_host && g_host->frames_per_block > 0) ? g_host->frames_per_block : 128) * 2;
    inst->input_backup = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    inst->input_mix = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    inst->last_output = (int16_t *)calloc((size_t)inst->scratch_samples, sizeof(int16_t));
    if (!inst->input_backup || !inst->input_mix || !inst->last_output || !inst->pfx_delay_buf || !inst->pfx_djfx_buf) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst->last_output);
        free(inst->pfx_djfx_buf);
        free(inst->pfx_delay_buf);
        free(inst);
        log_msg("TwinSampler monitor wrapper: scratch alloc failed");
        return NULL;
    }
    if (!load_core_for_instance(inst, module_dir)) {
        free(inst->input_backup);
        free(inst->input_mix);
        free(inst->last_output);
        free(inst->pfx_djfx_buf);
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
        free(inst->last_output);
        free(inst->pfx_djfx_buf);
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
    free(inst->last_output);
    free(inst->pfx_djfx_buf);
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
    if (!strcmp(key, "debug_sample_loads")) {
        inst->debug_sample_loads = parse_bool(val);
        return;
    }
    if (!strcmp(key, "edit_section")) {
        inst->edit_section = clampi(parse_int_or_default(val, inst->edit_section), 0, 1);
    } else if (!strcmp(key, "edit_bank")) {
        inst->edit_bank = clampi(parse_int_or_default(val, inst->edit_bank), 0, 7);
    } else if (!strcmp(key, "edit_slot")) {
        inst->edit_slot = clampi(parse_int_or_default(val, inst->edit_slot), 0, 15);
    } else if (!strcmp(key, "slot_sample_path")) {
        remember_slot_sample_path(inst, val ? val : "");
    } else if (!strcmp(key, "clear_slot_sample")) {
        clear_slot_sample_path_state(inst, val ? val : "");
    } else if (!strcmp(key, "slot_reverse_at")) {
        int sec = 0;
        int bank = 0;
        int slot = 0;
        const char *payload = NULL;
        if (parse_slot_sample_value(val ? val : "", &sec, &bank, &slot, &payload)) {
            const int reverse = parse_int_or_default(payload, 0) ? 1 : 0;
            if (inst->slot_reverse[sec][bank][slot] != reverse) {
                inst->slot_reverse[sec][bank][slot] = reverse;
                reload_slot_sample_for_reverse(inst, sec, bank, slot);
            } else {
                inst->slot_reverse[sec][bank][slot] = reverse;
            }
        }
    } else if (!strcmp(key, "slot_reverse")) {
        const int sec = clampi(inst->edit_section, 0, 1);
        const int bank = clampi(inst->edit_bank, 0, 7);
        const int slot = clampi(inst->edit_slot, 0, 15);
        const int reverse = parse_int_or_default(val, 0) ? 1 : 0;
        if (inst->slot_reverse[sec][bank][slot] != reverse) {
            inst->slot_reverse[sec][bank][slot] = reverse;
            reload_slot_sample_for_reverse(inst, sec, bank, slot);
        } else {
            inst->slot_reverse[sec][bank][slot] = reverse;
        }
    }
    if (!strcmp(key, "keyboard_section")) {
        int sec = parse_int_or_default(val, inst->pfx_active_section);
        if (sec < 0) sec = 0;
        if (sec > 1) sec = 1;
        inst->pfx_active_section = sec;
    }
    if (!strcmp(key, "section_bank_route")) {
        /*
         * Route-only bank switch used by MIDI looper playback.
         * Forward to core as section_bank, but keep wrapper PFX focus untouched
         * so bank FX do not flicker when routing cross-bank note events.
         */
        if (inst->core_api_v2 && inst->core_api_v2->set_param && inst->core_instance) {
            inst->core_api_v2->set_param(inst->core_instance, "section_bank", val ? val : "");
        }
        return;
    }
    if (!strcmp(key, "section_bank")) {
        int parts[2] = {0};
        const int n = parse_colon_ints(val, parts, 2);
        if (n >= 2) {
            const int sec = (parts[0] < 0) ? 0 : (parts[0] > 1 ? 1 : parts[0]);
            const int bank = (parts[1] < 0) ? 0 : (parts[1] > 7 ? 7 : parts[1]);
            inst->current_bank[sec] = bank;
            inst->pfx_active_section = sec;
        }
    } else if (!strncmp(key, "section_bank_", 13)) {
        const int sec = (key[13] == '1') ? 1 : 0;
        int bank = parse_int_or_default(val, inst->current_bank[sec]);
        if (bank < 0) bank = 0;
        if (bank > 7) bank = 7;
        inst->current_bank[sec] = bank;
        inst->pfx_active_section = sec;
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
        char rewritten_value[TS_SAMPLE_PARAM_BUF];
        const char *forward_val = val ? val : "";
        if (rewrite_sample_param_value(inst, key, forward_val, rewritten_value, sizeof(rewritten_value))) {
            forward_val = rewritten_value;
        }
        inst->core_api_v2->set_param(inst->core_instance, key, forward_val);
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
    if (!strcmp(key, "capture_internal_peak")) {
        return snprintf(buf, (size_t)buf_len, "%.4f", (double)inst->internal_peak_last);
    }
    if (!strcmp(key, "performance_fx_active_banks")) {
        return snprintf(buf, (size_t)buf_len, "%d:%d", inst->current_bank[0], inst->current_bank[1]);
    }
    if (!strcmp(key, "performance_fx_active_section")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->pfx_active_section ? 1 : 0);
    }
    if (!strcmp(key, "sample_load_diag")) {
        return snprintf(buf, (size_t)buf_len, "%s", inst->last_sample_diag);
    }
    if (!strcmp(key, "sample_load_fallback_count")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->sample_fallback_count);
    }
    if (!strcmp(key, "debug_sample_loads")) {
        return snprintf(buf, (size_t)buf_len, "%d", inst->debug_sample_loads ? 1 : 0);
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
    const int active_sec = (inst->pfx_active_section == 1) ? 1 : 0;
    int active_bank = inst->current_bank[active_sec];
    if (active_bank < 0 || active_bank >= 8) active_bank = 0;
    float d = 0.0f, c = 0.0f, l = 0.0f, h = 0.0f, t = 0.0f, n = 0.0f, q = 0.0f, g = 0.0f;
    float count = 0.0f;
    for (int fx = 0; fx < 16; fx++) {
        const int g_on = inst->pfx_global_toggle[fx] ? 1 : 0;
        const int b_on = inst->pfx_bank_toggle[active_sec][active_bank][fx] ? 1 : 0;
        const int on = g_on || b_on;
        if (!on) continue;
        float p[8];
        for (int i = 0; i < 8; i++) {
            float sum = 0.0f;
            int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][i]; w++; }
            if (b_on) { sum += inst->pfx_bank_param[active_sec][active_bank][fx][i]; w++; }
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
    const int active_sec = (inst->pfx_active_section == 1) ? 1 : 0;
    int active_bank = inst->current_bank[active_sec];
    if (active_bank < 0 || active_bank >= 8) active_bank = 0;
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
        const int b_on = inst->pfx_bank_toggle[active_sec][active_bank][fx] ? 1 : 0;
        on[fx] = g_on || b_on;
        if (on[fx]) any_on = 1;
        for (int p = 0; p < 8; p++) {
            float sum = 0.0f; int w = 0;
            if (g_on) { sum += inst->pfx_global_param[fx][p]; w++; }
            if (b_on) { sum += inst->pfx_bank_param[active_sec][active_bank][fx][p]; w++; }
            mix_params[fx][p] = (w > 0) ? (sum / (float)w) : 0.5f;
        }
    }

    if (!on[8]) inst->pfx_djfx_active = 0;

    /* True bypass: do not touch samples when all FX are off. */
    if (!any_on) return;

    for (int i = 0; i < frames; i++) {
        int dpos = inst->pfx_delay_pos;
        if (on[0]) {
            const float wow_rate = 0.08f + mix_params[0][2] * 1.2f;
            inst->pfx_phase_vinyl += (2.0f * (float)M_PI * wow_rate) / (float)sr;
            if (inst->pfx_phase_vinyl > 2.0f * (float)M_PI) inst->pfx_phase_vinyl -= 2.0f * (float)M_PI;
        }
        if (on[6]) {
            const float rate = 0.03f + mix_params[6][1] * 2.2f;
            inst->pfx_phase_chorus += (2.0f * (float)M_PI * rate) / (float)sr;
            if (inst->pfx_phase_chorus > 2.0f * (float)M_PI) inst->pfx_phase_chorus -= 2.0f * (float)M_PI;
        }

        for (int ch = 0; ch < 2; ch++) {
            const int idx = i * 2 + ch;
            float x = (float)out_interleaved_lr[idx] / 32768.0f;
            float prev_in = (ch == 0) ? inst->pfx_hp_prev_in_l : inst->pfx_hp_prev_in_r;
            float prev_out = (ch == 0) ? inst->pfx_hp_prev_out_l : inst->pfx_hp_prev_out_r;
            float lp_z = (ch == 0) ? inst->pfx_lp_z_l : inst->pfx_lp_z_r;
            inst->pfx_delay_buf[dpos * 2 + ch] = x; /* keep delay memory warm for instant toggles */

            /* FX1: 303 Vinyl Sim */
            if (on[0]) {
                const float age = mix_params[0][1];
                const float wow = mix_params[0][2];
                const float flutter = mix_params[0][3];
                const float dust = mix_params[0][4];
                const float wear = mix_params[0][5];
                const float tone = mix_params[0][6];
                const float out = 0.55f + mix_params[0][7] * 1.25f;
                const float stereo_phase = (ch == 0) ? 0.0f : 0.37f;
                const float slow = sinf(inst->pfx_phase_vinyl + stereo_phase) * wow * 5.0f;
                const float fast = sinf((float)(dpos + ch * 41) * (0.013f + flutter * 0.09f)) * flutter * 2.2f;
                int d = (int)(((2.0f + age * 8.0f + slow + fast) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                const int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                float wet = inst->pfx_delay_buf[ridx * 2 + ch];
                wet = wet * (0.62f + age * 0.22f) + x * (0.38f - age * 0.12f);
                wet = pfx_softclip(wet * (1.0f + wear * 2.2f)) * (0.92f - wear * 0.12f);
                wet += pfx_noise_from_u32(&inst->dither_state, dust * 0.018f);
                if ((xorshift32(&inst->dither_state) & 0x3ffu) < (uint32_t)(dust * dust * 18.0f)) {
                    wet += pfx_noise_from_u32(&inst->dither_state, 0.10f + dust * 0.10f);
                }
                wet = pfx_onepole_lp(&inst->pfx_fx_lp_z[0][ch], wet, 0.035f + tone * 0.52f);
                wet = pfx_onepole_hp(&inst->pfx_fx_hp_prev_in[0][ch], &inst->pfx_fx_hp_prev_out[0][ch], wet, 0.985f);
                x = pfx_xfade(x, wet, 0.35f + age * 0.45f) * out;
            }
            /* FX2: Isolator */
            if (on[1]) {
                const float low_gain = mix_params[1][1] * 2.2f;
                const float mid_gain = mix_params[1][2] * 2.2f;
                const float high_gain = mix_params[1][3] * 2.2f;
                const float xover = mix_params[1][4];
                const float res = mix_params[1][5];
                const float drive = 1.0f + mix_params[1][6] * 3.0f;
                const float out = 0.55f + mix_params[1][7] * 1.25f;
                const float low_c = 0.012f + xover * xover * 0.16f;
                const float high_c = 0.08f + sqrtf(xover) * 0.72f;
                const float low = pfx_onepole_lp(&inst->pfx_fx_lp_z[1][ch], x, low_c);
                const float high = pfx_onepole_hp(&inst->pfx_fx_hp_prev_in[1][ch], &inst->pfx_fx_hp_prev_out[1][ch], x, high_c);
                const float mid = x - low - high;
                float wet = low * low_gain + mid * mid_gain + high * high_gain;
                wet = pfx_softclip(wet * drive * (1.0f + res * 0.35f));
                x = wet * out;
            }
            /* FX3: Filter + Drive */
            if (on[2]) {
                const float cutoff = mix_params[2][1];
                const float res = mix_params[2][2];
                const float drive = mix_params[2][3];
                const float type = mix_params[2][4];
                const float env_amt = mix_params[2][5];
                const float mix = mix_params[2][6];
                const float out = 0.50f + mix_params[2][7] * 1.35f;
                const float in = pfx_softclip(x * (1.0f + drive * 8.0f));
                float f = 0.008f + cutoff * cutoff * 0.34f + fabsf(in) * env_amt * 0.12f;
                f = clampf(f, 0.005f, 0.36f);
                const float damp = 0.35f + (1.0f - res) * 1.25f;
                float *flp = &inst->pfx_fx_lp_z[2][ch];
                float *fbp = &inst->pfx_fx_bp_z[2][ch];
                const float hp = in - *flp - damp * *fbp;
                *fbp += f * hp;
                *flp += f * *fbp;
                float wet = *flp;
                if (type > 0.66f) wet = hp;
                else if (type > 0.33f) wet = *fbp * (1.0f + res * 1.4f);
                wet = pfx_softclip(wet * (1.0f + drive * 1.8f));
                x = pfx_xfade(x, wet, mix) * out;
            }
            /* FX4: Tape Echo / Delay */
            if (on[3]) {
                const float time = mix_params[3][1];
                const float feedback = mix_params[3][2] * 0.84f;
                const float mix = mix_params[3][3] * 0.78f;
                const float flutter = mix_params[3][4];
                const float tone = mix_params[3][5];
                const float duck_amt = mix_params[3][6];
                const float out = 0.50f + mix_params[3][7] * 1.35f;
                const float max_ms = clampf(loop_ms * 1.25f, 180.0f, 1400.0f);
                float delay_ms = 55.0f + time * time * (max_ms - 55.0f);
                delay_ms += sinf((float)(dpos + ch * 67) * (0.004f + flutter * 0.035f)) * flutter * 8.0f;
                int d = (int)((delay_ms / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                const int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                float wet = inst->pfx_delay_buf[ridx * 2 + ch];
                wet = pfx_onepole_lp(&inst->pfx_fx_lp_z[3][ch], wet, 0.025f + tone * 0.45f);
                wet = pfx_onepole_hp(&inst->pfx_fx_hp_prev_in[3][ch], &inst->pfx_fx_hp_prev_out[3][ch], wet, 0.992f);
                const float duck = 1.0f - duck_amt * clampf(fabsf(x), 0.0f, 1.0f) * 0.82f;
                const float fb_in = pfx_softclip((x + wet * feedback) * (1.0f + flutter * 0.8f));
                inst->pfx_delay_buf[dpos * 2 + ch] = fb_in;
                x = pfx_xfade(x, wet * duck, mix) * out;
            }
            /* FX5: Lo-Fi / Bit Crusher */
            if (on[4]) {
                const float bits = 16.0f - mix_params[4][1] * 12.0f;
                int hold = 1 + (int)(mix_params[4][2] * mix_params[4][2] * 96.0f);
                const float mix = mix_params[4][3];
                const float noise = mix_params[4][4];
                const float jitter = mix_params[4][5];
                const float tone = mix_params[4][6];
                const float out = 0.50f + mix_params[4][7] * 1.35f;
                hold += (int)(sinf((float)(dpos + ch * 103) * (0.021f + jitter * 0.11f)) * (float)hold * jitter * 0.55f);
                if (hold < 1) hold = 1;
                if (hold > 192) hold = 192;
                float pre_x = pfx_softclip(x * (1.0f + noise * 0.8f));
                if (inst->pfx_sr_hold_count_crush <= 0) {
                    if (ch == 0) inst->pfx_sr_hold_l_crush = pre_x;
                    else inst->pfx_sr_hold_r_crush = pre_x;
                    inst->pfx_sr_hold_count_crush = hold;
                }
                float crushed = (ch == 0) ? inst->pfx_sr_hold_l_crush : inst->pfx_sr_hold_r_crush;
                if (ch == 1) inst->pfx_sr_hold_count_crush--;
                const float levels = powf(2.0f, bits);
                crushed = floorf(crushed * levels + 0.5f) / levels;
                crushed += pfx_noise_from_u32(&inst->dither_state, noise * 0.025f);
                crushed = pfx_onepole_lp(&inst->pfx_fx_lp_z[4][ch], crushed, 0.025f + tone * 0.58f);
                x = pfx_xfade(x, crushed, mix) * out;
            }
            /* FX6: Hard Compressor */
            if (on[5]) {
                const float amount = mix_params[5][1];
                const float thresh = 0.86f - mix_params[5][2] * 0.78f;
                const float ratio = 2.0f + mix_params[5][3] * 18.0f;
                const float attack_ms = 0.25f + mix_params[5][4] * 25.0f;
                const float release_ms = 25.0f + mix_params[5][5] * 260.0f;
                const float drive = 1.0f + mix_params[5][6] * 3.5f;
                const float out = 0.45f + mix_params[5][7] * 1.45f;
                float *env = &inst->pfx_fx_env[5][ch];
                const float a = fabsf(x);
                const float coeff = 1.0f - expf(-1.0f / (((a > *env) ? attack_ms : release_ms) * 0.001f * (float)sr));
                *env += (a - *env) * coeff;
                float gain = 1.0f;
                if (*env > thresh) {
                    const float compressed = thresh + (*env - thresh) / ratio;
                    gain = compressed / (*env + 1.0e-6f);
                }
                const float makeup = 1.0f + amount * (1.1f + ratio * 0.035f);
                float wet = pfx_softclip(x * gain * makeup * drive) / pfx_softclip(drive);
                x = pfx_xfade(x, wet, 0.25f + amount * 0.75f) * out;
            }
            /* FX7: Chorus / Flanger */
            if (on[6]) {
                const float depth = mix_params[6][2];
                const float feedback = (mix_params[6][3] - 0.5f) * 0.72f;
                const float mix = mix_params[6][4] * 0.85f;
                const float mode = mix_params[6][5];
                const float stereo = (mix_params[6][6] - 0.5f) * 1.6f;
                const float out = 0.50f + mix_params[6][7] * 1.35f;
                const int chorus_mode = mode >= 0.5f;
                const float base_ms = chorus_mode ? 7.0f : 0.35f;
                const float depth_ms = chorus_mode ? (2.0f + depth * 22.0f) : (0.15f + depth * 6.0f);
                const float mod_phase = inst->pfx_phase_chorus + ((ch == 0) ? -stereo : stereo);
                int d = (int)(((base_ms + depth_ms * (0.5f + 0.5f * sinf(mod_phase))) / 1000.0f) * (float)sr);
                if (d < 1) d = 1;
                if (d >= inst->pfx_delay_len) d = inst->pfx_delay_len - 1;
                const int ridx = (dpos - d + inst->pfx_delay_len) % inst->pfx_delay_len;
                const float delayed = inst->pfx_delay_buf[ridx * 2 + ch];
                const float wet = chorus_mode ? pfx_onepole_lp(&inst->pfx_fx_lp_z[6][ch], delayed, 0.45f) : delayed;
                const float fb = chorus_mode ? feedback * 0.25f : feedback;
                inst->pfx_delay_buf[dpos * 2 + ch] = x + wet * fb;
                x = pfx_xfade(x, wet, mix) * out;
            }
            /* FX8: Resonator */
            if (on[7]) {
                const float tune = mix_params[7][1];
                const float res = mix_params[7][2];
                const float mix = mix_params[7][3];
                const float drive = mix_params[7][4];
                const float spread = (mix_params[7][5] - 0.5f) * 0.20f;
                const float low = mix_params[7][6] - 0.5f;
                const float high = mix_params[7][7] - 0.5f;
                float freq = 75.0f * powf(32.0f, clampf(tune + ((ch == 0) ? -spread : spread), 0.0f, 1.0f));
                if (freq > (float)sr * 0.40f) freq = (float)sr * 0.40f;
                const float f = clampf(2.0f * sinf((float)M_PI * freq / (float)sr), 0.002f, 0.72f);
                const float q = 0.22f + (1.0f - res) * 1.55f;
                const float in = pfx_softclip(x * (1.0f + drive * 6.0f));
                float *flp = &inst->pfx_fx_lp_z[7][ch];
                float *fbp = &inst->pfx_fx_bp_z[7][ch];
                const float hp = in - *flp - q * *fbp;
                *fbp += f * hp;
                *flp += f * *fbp;
                float wet = *fbp * (1.2f + res * 4.0f);
                wet += low * *flp * 0.8f + high * hp * 0.6f;
                wet = pfx_softclip(wet);
                x = pfx_xfade(in, wet, mix);
            }

            /* FX9: DJFX Looper */
            if (on[8]) {
                const float length = mix_params[8][1];
                const float speed_param = mix_params[8][2];
                const int loop_sw = mix_params[8][3] >= 0.5f;
                const float mix = mix_params[8][4];
                const float gate = 0.05f + mix_params[8][5] * 0.95f;
                const float tone = (mix_params[8][6] - 0.5f) * 0.8f;
                const float out = 0.35f + mix_params[8][7] * 1.65f;
                const float length_ms = 230.0f - length * 218.0f;
                int loop_len = (int)((length_ms / 1000.0f) * (float)sr);
                if (loop_len < 1) loop_len = 1;
                if (loop_len > inst->pfx_djfx_buf_len) loop_len = inst->pfx_djfx_buf_len;

                if (!loop_sw) {
                    inst->pfx_djfx_active = 0;
                } else if (!inst->pfx_djfx_active || inst->pfx_djfx_len != loop_len) {
                    inst->pfx_djfx_active = 1;
                    inst->pfx_djfx_len = loop_len;
                    inst->pfx_djfx_pos = speed_param >= 0.5f ? 0.0f : (float)(loop_len - 1);
                    for (int n = 0; n < loop_len; n++) {
                        int src = dpos - loop_len + n;
                        while (src < 0) src += inst->pfx_delay_len;
                        src %= inst->pfx_delay_len;
                        inst->pfx_djfx_buf[n * 2] = inst->pfx_delay_buf[src * 2];
                        inst->pfx_djfx_buf[n * 2 + 1] = inst->pfx_delay_buf[src * 2 + 1];
                    }
                }

                if (inst->pfx_djfx_active && inst->pfx_djfx_len > 0) {
                    int pos0 = (int)floorf(inst->pfx_djfx_pos);
                    float frac = inst->pfx_djfx_pos - (float)pos0;
                    while (pos0 < 0) pos0 += inst->pfx_djfx_len;
                    pos0 %= inst->pfx_djfx_len;
                    int pos1 = (pos0 + 1) % inst->pfx_djfx_len;
                    float wet = inst->pfx_djfx_buf[pos0 * 2 + ch] * (1.0f - frac) +
                        inst->pfx_djfx_buf[pos1 * 2 + ch] * frac;
                    const float phase = inst->pfx_djfx_len > 1
                        ? (inst->pfx_djfx_pos / (float)inst->pfx_djfx_len)
                        : 0.0f;
                    const float wrapped_phase = phase - floorf(phase);
                    if (wrapped_phase > gate) wet = 0.0f;
                    wet = pfx_onepole_lp(&inst->pfx_fx_lp_z[8][ch], wet, 0.08f + (tone + 0.5f) * 0.45f);
                    wet = pfx_onepole_hp(&inst->pfx_fx_hp_prev_in[8][ch], &inst->pfx_fx_hp_prev_out[8][ch], wet, 0.995f - (tone + 0.5f) * 0.18f);
                    x = pfx_xfade(x, wet, mix) * out;
                    if (ch == 1) {
                        float speed = (speed_param - 0.5f) * 2.0f;
                        if (fabsf(speed) < 0.015f) speed = 0.0f;
                        inst->pfx_djfx_pos += speed;
                        while (inst->pfx_djfx_pos < 0.0f) inst->pfx_djfx_pos += (float)inst->pfx_djfx_len;
                        while (inst->pfx_djfx_pos >= (float)inst->pfx_djfx_len) inst->pfx_djfx_pos -= (float)inst->pfx_djfx_len;
                    }
                }
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
        const int16_t *host_bus = (const int16_t *)(g_host->mapped_memory + g_host->audio_out_offset);
        const int16_t *internal_bus = inst->last_output;
        if (audio_in_rw && host_bus) {
            const float input_peak = peak_abs_i16(audio_in_rw, total);
            const float host_bus_peak = peak_abs_i16(host_bus, total);
            const float internal_peak = (internal_bus && total <= inst->scratch_samples)
                ? peak_abs_i16(internal_bus, total)
                : 0.0f;
            const int input_active = (input_peak > 0.012f) || (inst->input_active_prev && input_peak > 0.006f);
            const int internal_active = (internal_peak > 0.012f);
            const int use_internal_bus = inst->record_intent_internal && internal_active;
            const int16_t *capture_bus = use_internal_bus ? internal_bus : host_bus;
            const float bus_peak = use_internal_bus ? internal_peak : host_bus_peak;
            const int bus_active = (bus_peak > 0.012f) || (inst->bus_active_prev && bus_peak > 0.006f);
            inst->input_peak_last = input_peak;
            inst->bus_peak_last = bus_peak;
            inst->internal_peak_last = internal_peak;
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
                if (inst->record_intent_internal && internal_active) desired_capture_source = 2;
                else if (input_active && bus_active) desired_capture_source = 3;
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
                    const int32_t bus_only = (int32_t)((float)capture_bus[i] * rec_gain);
                    inst->input_mix[i] = (int16_t)clip_i32_to_i16(bus_only);
                }
                memcpy(audio_in_rw, inst->input_mix, (size_t)total * sizeof(int16_t));
                input_replaced = 1;
            } else if (capture_source == 3 && inst->record_mix_schwung) {
                const float rec_gain = inst->record_mix_gain;
                const float dual_mix_gain = 0.70710678f;
                for (int i = 0; i < total; i++) {
                    const float in_f = (float)audio_in_rw[i] * dual_mix_gain;
                    const float bus_f = ((float)capture_bus[i] * rec_gain) * dual_mix_gain;
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

    if (inst->last_output && total <= inst->scratch_samples) {
        memcpy(inst->last_output, out_interleaved_lr, (size_t)total * sizeof(int16_t));
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
