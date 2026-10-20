import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createParamTransport } from '../twinsampler/param_transport.mjs';
import { makeWaveIo, createWaveform, sourceSliceFrames, moveSliceBoundary } from '../twinsampler/waveform.mjs';
import { fxPresetRow, fxPresetName, fxPresetDisplayName } from '../twinsampler/fx_presets.mjs';

// Decode bytes as the Schwung shim does, not JS UTF-16 character offsets.
function decodeBulk(blob) {
    const bytes = Buffer.from(blob);
    let pos = bytes.indexOf(10) + 1;
    const count = Number(bytes.subarray(0, pos - 1).toString());
    assert.ok(count <= 64 && count % 2 === 0);
    const records = [];
    for (let i = 0; i < count; i++) {
        const end = bytes.indexOf(10, pos);
        const length = Number(bytes.subarray(pos, end).toString());
        pos = end + 1;
        records.push(bytes.subarray(pos, pos + length).toString());
        pos += length;
    }
    assert.equal(pos, bytes.length);
    return Array.from({ length: count / 2 }, (_, i) => records.slice(i * 2, i * 2 + 2));
}

test('transport preserves order, separates heavy writes, and bounds batches', () => {
    const actual = [];
    const expected = [];
    const transport = createParamTransport({
        hasBulk: () => true,
        setMany: blob => { actual.push(...decodeBulk(blob)); return true; },
        set: (key, value) => actual.push([key, value])
    });
    transport.batch(() => {
        for (let i = 0; i < 40; i++) {
            const pair = ['slot_gain_at', '0:0:' + (i % 16) + ':0.5'];
            expected.push(pair);
            transport.set(...pair, 250);
        }
        for (const pair of [
            ['slot_sample_path', '0:0:0:/Samples/é🎹.wav'],
            ['slot_reverse_at', '0:0:0:1'],
            ['slot_loop_at', '0:0:0:2'],
            ['pfx_global_toggle', '1:1']
        ]) {
            expected.push(pair);
            transport.set(...pair, 1500);
        }
    });
    assert.deepEqual(actual, expected);
    assert.equal(transport.stats.batches, 4);
    assert.equal(transport.stats.singles, 3);
});

test('unavailable or failed bulk falls back to ordered single writes', () => {
    for (const failure of [false, null, 'throw']) {
        const writes = [];
        let attempts = 0;
        const transport = createParamTransport({
            hasBulk: () => true,
            setMany: () => { attempts++; if (failure === 'throw') throw Error('timeout'); return failure; },
            set: (...args) => writes.push(args)
        });
        transport.batch(() => {
            transport.set('slot_gain_at', '0:0:0:0.5');
            transport.set('slot_pan_at', '0:0:0:0.2');
        });
        assert.deepEqual(writes, [
            ['slot_gain_at', '0:0:0:0.5', 250],
            ['slot_pan_at', '0:0:0:0.2', 250]
        ]);
        assert.equal(attempts, 1);
        assert.equal(transport.canBatch(), false);
    }
});

const source = readFileSync(new URL('../twinsampler/ui_chain.js', import.meta.url), 'utf8');

function makeUi(bulk, ready = '1', withSession = true) {
    const writes = [];
    const files = new Map();
    let session;
    let clock = 0;
    let calls = 0;
    const context = vm.createContext({
        createParamTransport,
        makeWaveIo, createWaveform, sourceSliceFrames, moveSliceBoundary, fxPresetRow, fxPresetName, fxPresetDisplayName,
        os: { stat: () => [{ mode: 0o040755 }, 0] },
        moveConstants: {}, moveInputFilter: {},
        Date: class extends Date { static now() { return clock; } },
        console: { log() {} },
        host_module_get_param: key => key === '__ready' ? ready : undefined,
        host_module_set_param: (key, value) => { calls++; writes.push([key, value]); clock += 1; },
        host_module_set_param_blocking: (key, value) => { calls++; writes.push([key, value]); clock += 1; },
        host_read_file: path => path.endsWith('twinsampler-autosave-v1.json') ? session : files.get(path),
        host_write_file: (path, text) => files.set(path, text),
        host_suspend_overtake() {},
        move_midi_internal_send() {},
        move_midi_external_send() {}
    });
    if (bulk) context.host_module_set_params = blob => {
        calls++;
        clock += 1;
        writes.push(...decodeBulk(blob));
        return true;
    };
    vm.runInContext(source.replace(/^import .*;\r?$/gm, '') + `
        // Hardware display/MIDI painting isn't part of these restore tests.
        draw = () => {};
        clearPadAndStepLeds = () => {};
        tickBootLedSweep = () => {};
        forceLedRefreshNow = () => {};
        globalThis.testUi = { s, init, tick, beforeExit, requestLeaveBackground,
            makeInitSessionPayload, serializeSession, paramTransport, startSessionLoad,
            handleMainKnob, handleParamKnob, handleBackButton, openSampleEditor,
            adjustEditorEdge, sampleWave, beginLoading, onMidiMessageExternal,
            tickSampleEditor, drawSampleEditor, setSlotEndTrim, saveSessionToPath };
    `, context);
    if (withSession) {
        const payload = context.testUi.makeInitSessionPayload();
        payload.velocitySens = 1;
        for (let sec = 0; sec < 2; sec++) {
            for (let bank = 0; bank < 8; bank++) {
                const b = payload.sections[sec].banks[bank];
                b.sourcePath = '/Samples/source-' + sec + '-' + bank + '.wav';
                b.sliceStarts = Array.from({ length: 17 }, (_, i) => i * 1000);
                for (let slot = 0; slot < 16; slot++) {
                    Object.assign(b.slots[slot], {
                        path: '/Samples/é-pad-' + sec + '-' + bank + '-' + slot + '.wav',
                        gain: 0.25 + slot / 32, pitch: slot - 8, reverse: slot % 2,
                        loop: slot % 3, startTrim: slot, endTrim: -slot
                    });
                }
            }
        }
        session = JSON.stringify(payload);
    }
    return { context, writes, files, setReady: value => { ready = value; },
        get calls() { return calls; }, get ui() { return context.testUi; } };
}

function boot(app) {
    app.ui.init();
    let ticks = 0;
    while (app.ui.s.bootActive && ticks < 3000) { app.ui.tick(); ticks++; }
    assert.equal(app.ui.s.bootActive, false, 'startup must complete');
    assert.equal(app.ui.s.view, 'main');
    return ticks;
}

test('full startup restores identical writes with bulk and legacy hosts', () => {
    for (const withSession of [false, true]) {
        const legacy = makeUi(false, '1', withSession);
        const bulk = makeUi(true, '1', withSession);
        const legacyTicks = boot(legacy);
        const bulkTicks = boot(bulk);
        assert.deepEqual(bulk.writes, legacy.writes, 'all settings, loads and replays must be preserved in order');
        assert.equal(JSON.stringify(bulk.ui.serializeSession()), JSON.stringify(legacy.ui.serializeSession()));
        assert.ok(bulk.calls < legacy.calls * 0.65, 'bulk must reduce host round-trips substantially');
        assert.ok(bulkTicks < legacyTicks);
        if (withSession) {
            assert.equal(bulk.ui.s.velocitySens, 1);
            assert.equal(bulk.writes.filter(([key]) => key === 'slot_sample_path').length, 256);
            assert.equal(bulk.writes.filter(([key]) => key === 'section_source_path').length, 16);
        }
        console.log(`${withSession ? 'Full session' : 'INIT'}: ${legacy.calls} → ${bulk.calls} write round-trips; ${legacyTicks} → ${bulkTicks} ticks (simulated host)`);
    }
});

test('DSP readiness blocks restore and cancelling boot preserves autosave', () => {
    const app = makeUi(true, '0');
    app.ui.init();
    app.ui.tick();
    assert.equal(app.ui.s.bootPhase, 0);
    assert.equal(app.writes.length, 0);
    app.ui.beforeExit();
    app.ui.requestLeaveBackground();
    assert.equal(app.files.size, 0, 'no partial session may overwrite autosave');
    app.setReady('1');
    let ticks = 0;
    while (app.ui.s.bootActive && ticks++ < 3000) app.ui.tick();
    assert.equal(app.ui.s.bootActive, false);
    app.ui.beforeExit();
    assert.ok([...app.files.keys()].some(path => path.endsWith('twinsampler-autosave-v1.json')));
});

test('background action prefers official overtake suspend', () => {
    const calls = [];
    const context = vm.createContext({
        moveConstants: {}, console,
        host_suspend_overtake: () => calls.push('suspend'),
        host_hide_module: () => calls.push('hide'),
        shadow_set_overtake_mode: () => calls.push('mode')
    });
    const wrapper = readFileSync(new URL('../twinsampler/ui.js', import.meta.url), 'utf8');
    vm.runInContext(wrapper.replace(/^import .*;\r?$/gm, ''), context);
    context.twinsampler_leave_background();
    assert.deepEqual(calls, ['suspend']);
});

test('READY has no delayed full-session or focused-pad replay', () => {
    const app = makeUi(true);
    boot(app);
    const writesAtReady = app.writes.length;
    for (let i = 0; i < 120; i++) app.ui.tick();
    const padWrites = app.writes.slice(writesAtReady).filter(([key]) =>
        /^(?:slot_|slice_|edit_|selected_)/.test(key));
    assert.deepEqual(padWrites, [], 'no pad settings storm after startup');
    assert.equal(app.ui.s.trimReplayPendingAll, false);
    assert.equal(app.ui.s.focusedParamRefreshTicks, 0);
});

test('project load paints first, restores fully, gates notes and protects autosave', () => {
    const app = makeUi(true);
    boot(app);
    const path = '/test/project.json';
    app.files.set(path, JSON.stringify(app.ui.serializeSession()));
    app.context.host_read_file = p => app.files.get(p);
    const before = app.writes.length;
    assert.equal(app.ui.startSessionLoad(path), true);
    assert.equal(app.ui.s.view, 'loading');
    app.ui.onMidiMessageExternal([0x90, 36, 127]);
    app.ui.tick(); app.ui.tick();
    assert.equal(app.writes.length, before, 'display gets two frames before restore');
    app.ui.beforeExit();
    assert.equal(app.files.has('/data/UserData/UserLibrary/twinsampler-autosave-v1.json'), false);
    let ticks = 0;
    while (app.ui.s.operationActive && ticks++ < 3000) app.ui.tick();
    assert.equal(app.ui.s.operationActive, false);
    assert.equal(app.ui.s.view, 'main');
    assert.equal(app.ui.s.operationError, '');
    const restored = app.writes.slice(before);
    assert.equal(restored.filter(([key]) => key === 'slot_sample_path').length, 256);
    assert.equal(restored.filter(([key]) => key === 'section_source_path').length, 16);
    assert.equal(app.ui.s.trimReplayPendingAll, false);
});

test('invalid project is reported without replacing current session', () => {
    const app = makeUi(true);
    boot(app);
    const saved = JSON.stringify(app.ui.serializeSession());
    app.ui.startSessionLoad('/missing.json');
    while (app.ui.s.operationActive) app.ui.tick();
    assert.match(app.ui.s.operationError, /invalid/);
    assert.equal(JSON.stringify(app.ui.serializeSession()), saved);
});

function attachWaveFile(app) {
    const data = Buffer.alloc(44 + 48000 * 4);
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
    data.writeUInt32LE(48000, 24); data.writeUInt32LE(192000, 28);
    data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
    data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
    let pos = 0;
    Object.assign(app.context.os, {
        open: () => { pos = 0; return 1; }, close() {},
        seek: (fd, value, mode) => { pos = mode === 2 ? data.length : value; return pos; },
        read: (fd, buffer, offset, length) => {
            const n = Math.min(length, data.length - pos);
            new Uint8Array(buffer, offset, n).set(data.subarray(pos, pos + n)); pos += n; return n;
        }
    });
}

test('sample/chop pages edit correct addresses, preserve end sign and return safely', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 2; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('trim');
    app.ui.tickSampleEditor();
    assert.equal(app.ui.sampleWave.model().info.rate, 48000);
    app.ui.handleParamKnob(73, 1); // K3, start trim.
    assert.equal(app.ui.s.sections[0].banks[0].slots[2].startTrim, 3);
    app.ui.handleParamKnob(74, 1); // K4, end extension.
    assert.ok(app.writes.some(([key, value]) => key === 'slot_end_trim_at' && value === '0:0:2:1.00'));
    app.ui.openSampleEditor('chop');
    const before = app.ui.s.sections[0].banks[0].sliceStarts.slice();
    app.ui.adjustEditorEdge('start', 1);
    const after = app.ui.s.sections[0].banks[0].sliceStarts;
    assert.equal(after[2], before[2] + 44);
    assert.equal(after[1], before[1]); assert.equal(after[3], before[3]);
    assert.ok(app.writes.some(([key, value]) => key === 'section_slice_starts' && value.startsWith('0:0:')));
    app.ui.handleMainKnob(1);
    assert.equal(app.ui.s.selectedSlice, 3);
    const text = [];
    app.context.clear_screen = () => {};
    app.context.print = (x, y, str) => text.push(String(str));
    app.context.fill_rect = () => {};
    app.ui.drawSampleEditor();
    assert.ok(text.some(line => line.startsWith('CHOP')));
    app.ui.handleBackButton();
    assert.equal(app.ui.s.view, 'main');
    app.ui.s.focusedSection = 1; app.ui.s.selectedSlice = 16;
    app.ui.openSampleEditor('chop');
    assert.equal(app.ui.s.view, 'trim', 'per-pad samples must not alter bank cuts');
});

test('explicit save has a loading screen and writes only after its first frames', () => {
    const app = makeUi(true); boot(app);
    const path = '/test/new-project.json';
    assert.equal(app.ui.saveSessionToPath(path, 'TEST', false, false), true);
    assert.equal(app.ui.s.view, 'loading');
    app.ui.tick(); app.ui.tick();
    assert.equal(app.files.has(path), false);
    while (app.ui.s.operationActive) app.ui.tick();
    assert.equal(JSON.parse(app.files.get(path)).sessionName, app.ui.s.sessionName);
});
