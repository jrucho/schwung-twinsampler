/* Bounded, cancellable UI-thread waveform scanning. No file reads at startup.
 * Peaks are an overview (large columns sample a bounded centred window), not
 * an audio analysis source. Slice positions always use actual WAV duration. */
export function makeWaveIo(os) {
    return {
        open(path) { try { return os.open(path, os.O_RDONLY || 0); } catch (e) { return -1; } },
        close(fd) { try { os.close(fd); } catch (e) {} },
        seek(fd, pos) { try { return os.seek(fd, pos, 0); } catch (e) { return -1; } },
        read(fd, bytes) { try { return os.read(fd, bytes.buffer, 0, bytes.length); } catch (e) { return -1; } },
        size(fd) { try { const n = os.seek(fd, 0, 2); os.seek(fd, 0, 0); return n; } catch (e) { return 0; } }
    };
}

export function readWaveInfo(io, path) {
    const fd = io.open(path);
    if (fd < 0) return null;
    try {
        const head = new Uint8Array(12);
        const tag = (b, at) => String.fromCharCode(...b.subarray(at, at + 4));
        if (io.read(fd, head) !== 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') return null;
        const fileSize = io.size(fd);
        let format = 0, channels = 0, rate = 0, bits = 0, align = 0, offset = 0, dataBytes = 0;
        for (let pos = 12, guard = 0; guard < 128 && (!offset || !rate); guard++) {
            const chunk = new Uint8Array(8);
            if (io.seek(fd, pos) < 0 || io.read(fd, chunk) !== 8) break;
            const size = new DataView(chunk.buffer).getUint32(4, true);
            const id = tag(chunk, 0);
            if (id === 'fmt ') {
                const bytes = new Uint8Array(Math.min(size, 40));
                if (bytes.length < 16 || io.read(fd, bytes) !== bytes.length) return null;
                const v = new DataView(bytes.buffer);
                format = v.getUint16(0, true); channels = v.getUint16(2, true);
                rate = v.getUint32(4, true); align = v.getUint16(12, true); bits = v.getUint16(14, true);
                if (format === 65534 && bytes.length >= 40) format = v.getUint16(24, true);
            } else if (id === 'data') { offset = pos + 8; dataBytes = size; }
            pos += 8 + size + (size & 1);
            if (pos > fileSize && fileSize > 0) break;
        }
        if (!(rate > 0) || channels < 1 || channels > 32 || !offset ||
            !((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) ||
            align !== channels * bits / 8) return null;
        if (fileSize > 0) dataBytes = Math.min(dataBytes, Math.max(0, fileSize - offset));
        const frames = Math.floor(dataBytes / align);
        if (frames < 1) return null;
        return { path, format, channels, rate, bits, align, offset, frames, durationMs: frames * 1000 / rate };
    } catch (e) { return null; }
    finally { io.close(fd); }
}

export function createWaveform(io, now = () => Date.now()) {
    let path = '', info = null, scan = null, fd = -1, key = '', status = '', zoom = 1, center = 0.5, reverse = false;
    const cache = new Map();
    const infoCache = new Map();
    function close() { if (fd >= 0) io.close(fd); fd = -1; }
    function reset() { close(); scan = null; key = ''; }
    function target(next, reversed = false) {
        if (next === path && reverse === reversed) return;
        reset(); path = next; reverse = reversed; info = infoCache.get(next) || null; status = ''; zoom = 1; center = 0.5;
    }
    function invalidate() { reset(); info = null; cache.clear(); infoCache.clear(); }
    function changeZoom(delta, anchor) {
        zoom = Math.max(1, Math.min(128, delta > 0 ? zoom * 2 : zoom / 2));
        if (Number.isFinite(anchor)) center = Math.max(0, Math.min(1, anchor));
        reset();
    }
    function scroll(delta) { center = Math.max(0, Math.min(1, center + delta / zoom / 3)); reset(); }
    function window() {
        const width = 1 / zoom;
        const from = Math.max(0, Math.min(1 - width, center - width / 2));
        return { from, to: from + width };
    }
    function tick() {
        if (!path) { status = 'No sample'; return false; }
        if (status) return false;
        if (!info && !status) {
            info = readWaveInfo(io, path);
            if (!info) status = 'Cannot read WAV';
            else {
                infoCache.set(path, info);
                while (infoCache.size > 32) infoCache.delete(infoCache.keys().next().value);
            }
        }
        if (!info) return false;
        const w = window();
        const nextKey = path + ':' + reverse + ':' + info.frames + ':' + w.from + ':' + w.to;
        if (nextKey !== key) {
            close(); key = nextKey;
            scan = cache.get(key) || { min: new Float32Array(128), max: new Float32Array(128), col: 0 };
            cache.set(key, scan);
            while (cache.size > 4) cache.delete(cache.keys().next().value);
        }
        if (scan.col >= 128) return false;
        if (fd < 0) fd = io.open(path);
        if (fd < 0) { status = 'Sample unavailable'; return false; }
        const start = now();
        let spent = 0;
        while (scan.col < 128 && spent < 8192) {
            const a = w.from + (w.to - w.from) * scan.col / 128;
            const b = w.from + (w.to - w.from) * (scan.col + 1) / 128;
            const first = Math.min(info.frames - 1, Math.floor((reverse ? 1 - b : a) * info.frames));
            const last = Math.min(info.frames, Math.max(first + 1,
                Math.floor((reverse ? 1 - a : b) * info.frames)));
            const count = Math.min(last - first, Math.max(1, Math.floor(8192 / info.align)));
            const from = first + Math.floor((last - first - count) / 2);
            const bytes = new Uint8Array(count * info.align);
            if (io.seek(fd, info.offset + from * info.align) < 0 || io.read(fd, bytes) !== bytes.length) {
                status = 'Sample read failed'; close(); return true;
            }
            spent += bytes.length;
            const v = new DataView(bytes.buffer);
            const stride = Math.max(1, Math.ceil(count / 512));
            let lo = 0, hi = 0;
            for (let frame = 0; frame < count; frame += stride) for (let ch = 0; ch < info.channels; ch++) {
                const at = frame * info.align + ch * info.bits / 8;
                let value;
                if (info.format === 3) value = v.getFloat32(at, true);
                else if (info.bits === 8) value = (bytes[at] - 128) / 128;
                else if (info.bits === 16) value = v.getInt16(at, true) / 32768;
                else if (info.bits === 24) value = ((bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16) << 8 >> 8) / 8388608;
                else value = v.getInt32(at, true) / 2147483648;
                if (Number.isFinite(value)) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
            }
            scan.min[scan.col] = Math.max(-1, lo); scan.max[scan.col++] = Math.min(1, hi);
            if (now() - start >= 3) break;
        }
        if (scan.col === 128) {
            close();
        }
        return true;
    }
    function model() { return { path, info, scan, status, zoom, ...window() }; }
    function infoFor(next) { return next === path && info ? info : infoCache.get(next) || null; }
    return { target, tick, model, changeZoom, scroll, close, invalidate, infoFor };
}

/* Shared source/chop coordinates use the core's 44.1k domain, not file frames. */
export function sourceSliceFrames(starts, durationMs) {
    const total = Math.max(1, Math.round(durationMs * 44.1));
    if (Array.isArray(starts) && starts.length === 17 && starts.every((v, i) =>
        Number.isFinite(v) && v >= 0 && v <= total && (!i || v >= starts[i - 1]))) return starts.slice();
    return Array.from({ length: 17 }, (_, i) => Math.floor(i * total / 16));
}

export function moveSliceBoundary(starts, slot, edge, deltaFrames, allowOuter = false, totalFrames = 0) {
    const out = starts.slice();
    const at = edge === 'end' ? slot + 1 : slot;
    if (at < 0 || at > 16) return out;
    if (!allowOuter && (at <= 0 || at >= 16)) return out;
    if (at === 16 && (!allowOuter || totalFrames <= 0)) return out;
    const min = at === 0 ? 0 : out[at - 1] + 1;
    const max = at === 16 ? totalFrames : out[at + 1] - 1;
    if (min <= max) out[at] = Math.max(min, Math.min(max, out[at] + Math.round(deltaFrames)));
    return out;
}
