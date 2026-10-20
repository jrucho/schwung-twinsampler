import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWaveform, readWaveInfo, sourceSliceFrames, moveSliceBoundary } from '../twinsampler/waveform.mjs';
import { FX_PRESETS, fxPresetRow } from '../twinsampler/fx_presets.mjs';
import { execFileSync } from 'node:child_process';

function wav(bits = 16, format = 1, rate = 48000, frames = 48000) {
    const align = 2 * bits / 8;
    const bytes = Buffer.alloc(56 + frames * align);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
    // An odd-length metadata chunk before fmt/data must be skipped with padding.
    bytes.write('JUNK', 12); bytes.writeUInt32LE(3, 16); bytes.write('abc', 20);
    bytes.write('fmt ', 24); bytes.writeUInt32LE(16, 28); bytes.writeUInt16LE(format, 32);
    bytes.writeUInt16LE(2, 34); bytes.writeUInt32LE(rate, 36);
    bytes.writeUInt32LE(rate * align, 40); bytes.writeUInt16LE(align, 44); bytes.writeUInt16LE(bits, 46);
    bytes.write('data', 48); bytes.writeUInt32LE(frames * align, 52);
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) {
        const value = (i < frames / 2 ? 0.3 : 0.8) * Math.sin(i * 0.2);
        const at = 56 + i * align + ch * bits / 8;
        if (format === 3) bytes.writeFloatLE(value, at);
        else if (bits === 8) bytes[at] = Math.round(128 + value * 127);
        else if (bits === 16) bytes.writeInt16LE(Math.round(value * 32767), at);
        else if (bits === 24) bytes.writeIntLE(Math.round(value * 8388607), at, 3);
        else bytes.writeInt32LE(Math.round(value * 2147483647), at);
    }
    return bytes;
}

function memoryIo(bytes) {
    let offset = 0, opens = 0, closes = 0, reads = 0, bytesRead = 0;
    return {
        open() { opens++; offset = 0; return 1; },
        close() { closes++; },
        seek(fd, pos) { offset = pos; return pos; },
        read(fd, target) { const n = Math.min(target.length, Math.max(0, bytes.length - offset)); target.set(bytes.subarray(offset, offset + n)); offset += n; reads++; bytesRead += n; return n; },
        size() { return bytes.length; },
        stats: () => ({ opens, closes, reads, bytesRead })
    };
}

test('WAV scanner supports metadata and PCM8/16/24/32 + float32 with bounded ticks', () => {
    for (const [bits, format] of [[8, 1], [16, 1], [24, 1], [32, 1], [32, 3]]) {
        const io = memoryIo(wav(bits, format));
        const wave = createWaveform(io, () => 0);
        wave.target('test.wav');
        assert.equal(io.stats().opens, 0, 'request itself must not block on file reads');
        let ticks = 0;
        while ((!wave.model().scan || wave.model().scan.col < 128) && ticks++ < 1000) {
            const before = io.stats().bytesRead;
            wave.tick();
            // At most one column can overshoot the tick budget; header <= 64 B.
            assert.ok(io.stats().bytesRead - before <= 16448);
        }
        const m = wave.model();
        assert.equal(m.scan.col, 128);
        assert.equal(m.info.durationMs, 1000);
        assert.ok(m.scan.max[15] > 0.2 && m.scan.max[100] > 0.7);
        assert.equal(io.stats().opens, io.stats().closes);
        wave.changeZoom(1, 0.8); wave.tick();
        wave.close();
        assert.equal(io.stats().opens, io.stats().closes);
    }
});

test('reversed waveform, cancellation and corrupt input are handled safely', () => {
    const io = memoryIo(wav());
    const wave = createWaveform(io, () => 0);
    wave.target('reverse.wav', true);
    while (!wave.model().scan || wave.model().scan.col < 128) wave.tick();
    assert.ok(wave.model().scan.max[15] > wave.model().scan.max[100]);
    wave.changeZoom(1, 0.5); wave.tick(); wave.target('other.wav'); wave.close();
    assert.equal(io.stats().opens, io.stats().closes);
    assert.equal(readWaveInfo(memoryIo(Buffer.alloc(12)), 'bad.wav'), null);
    const invalid = wav(); invalid.writeUInt16LE(0, 44);
    assert.equal(readWaveInfo(memoryIo(invalid), 'bad-align.wav'), null);
});

test('slice edits stay ordered in core frame domain for 48k samples', () => {
    const cuts = sourceSliceFrames([], 1000);
    assert.equal(cuts[16], 44100);
    const changed = moveSliceBoundary(cuts, 2, 'start', 999999);
    assert.ok(changed[2] > changed[1] && changed[2] < changed[3]);
    assert.equal(changed[0], 0); assert.equal(changed[16], 44100);
    assert.deepEqual(moveSliceBoundary(cuts, 0, 'start', 300), cuts);
    assert.deepEqual(sourceSliceFrames(cuts, 1000), cuts);
});

test('all named presets render through DSP wrapper without clipping the fixture', () => {
    const input = [];
    for (let fx = 0; fx < 9; fx++) {
        assert.equal(new Set(FX_PRESETS[fx].map(row => row[0])).size, 5);
        for (let preset = 0; preset < 5; preset++) {
            const row = fxPresetRow(fx, preset);
            assert.equal(row.length, 8);
            assert.ok(row.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
            input.push([fx, ...row].join(' '));
        }
    }
    const result = execFileSync(new URL('../dist/dsp_regression', import.meta.url).pathname, [], {
        input: input.join('\n'), encoding: 'utf8'
    });
    assert.match(result, /45 preset renders/);
});
