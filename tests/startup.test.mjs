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
        host_preview_play: path => writes.push(['preview_play', path]),
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
            onMidiMessageInternal, tickSampleEditor, drawSampleEditor,
            setSlotEndTrim, saveSessionToPath, chopCuePadLit, applyParsedSession,
            rebuildLedQueue };
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
        advanceMs: ms => { clock += ms; },
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
    app.ui.tickSampleEditor();
    const randomBefore = app.ui.s.sections[0].banks[0].sliceStarts.slice();
    const empty = app.ui.s.sections[0].banks[0].manualSliceStarts;
    assert.equal(empty[0], 0);
    assert.ok(empty.slice(1).every((v) => v === empty[16]), 'CHOP starts with no internal cues');
    app.ui.s.sections[0].banks[0].manualSliceStarts = randomBefore.slice();
    const before = app.ui.s.sections[0].banks[0].manualSliceStarts.slice();
    app.ui.adjustEditorEdge('start', 1);
    const after = app.ui.s.sections[0].banks[0].manualSliceStarts;
    assert.equal(after[2], before[2] + 44);
    assert.equal(after[1], before[1]); assert.equal(after[3], before[3]);
    assert.deepEqual(app.ui.s.sections[0].banks[0].sliceStarts, randomBefore,
        'manual chop edits must not replace the random map');
    assert.ok(app.writes.some(([key, value]) => key === 'section_slice_starts' && value.startsWith('0:0:')));
    app.ui.handleMainKnob(1);
    assert.equal(app.ui.s.selectedSlice, 3);
    const text = [];
    app.context.clear_screen = () => {};
    app.context.print = (x, y, str) => text.push(String(str));
    app.context.fill_rect = () => {};
    app.ui.drawSampleEditor();
    assert.ok(text.some(line => line.startsWith('CHOP')));
    const randomizeWrites = () => app.writes.filter(([key]) => key === 'section_randomize_transients').length;
    const beforeChopCapture = randomizeWrites();
    app.ui.onMidiMessageInternal([0xB0, 52, 127]);
    assert.equal(randomizeWrites(), beforeChopCapture + 1);
    assert.equal(app.ui.s.view, 'chop', 'Capture must keep the chop editor open');
    assert.match(app.ui.s.statusText, /randomized/);
    app.ui.openSampleEditor('trim');
    const beforeTrimCapture = randomizeWrites();
    app.ui.onMidiMessageInternal([0xB0, 52, 127]);
    assert.equal(randomizeWrites(), beforeTrimCapture + 1);
    assert.equal(app.ui.s.view, 'trim', 'Capture must keep the trim editor open');
    app.ui.handleBackButton();
    assert.equal(app.ui.s.view, 'main');
    app.ui.s.focusedSection = 1; app.ui.s.selectedSlice = 16;
    app.ui.openSampleEditor('chop');
    assert.equal(app.ui.s.view, 'trim', 'per-pad samples must not alter bank cuts');
});

test('arrows navigate main, Trim and CHOP one level at a time', () => {
    const app = makeUi(true);
    boot(app);
    const arrow = cc => {
        app.ui.onMidiMessageInternal([0xB0, cc, 127]);
        app.ui.onMidiMessageInternal([0xB0, cc, 0]);
    };
    arrow(47);
    assert.equal(app.ui.s.view, 'trim');
    arrow(47);
    assert.equal(app.ui.s.view, 'chop');
    arrow(47);
    assert.equal(app.ui.s.view, 'chop', 'Down stays at the bottom level');
    arrow(46);
    assert.equal(app.ui.s.view, 'trim');
    arrow(46);
    assert.equal(app.ui.s.view, 'main');
});

test('held arrow messages and pad playback cannot advance Trim back to CHOP', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.onMidiMessageInternal([0xB0, 47, 127]);
    assert.equal(app.ui.s.view, 'trim');
    app.ui.onMidiMessageInternal([0xB0, 47, 127]);
    assert.equal(app.ui.s.view, 'trim', 'a held Down cannot skip Trim');
    app.ui.onMidiMessageInternal([0xB0, 47, 0]);
    app.ui.onMidiMessageInternal([0xB0, 47, 127]);
    assert.equal(app.ui.s.view, 'chop');
    app.ui.onMidiMessageInternal([0xB0, 47, 0]);
    app.ui.onMidiMessageInternal([0xB0, 46, 127]);
    assert.equal(app.ui.s.view, 'trim');
    app.ui.onMidiMessageInternal([0xB0, 46, 127]);
    assert.equal(app.ui.s.view, 'trim', 'a held Up cannot skip Trim');
    app.ui.onMidiMessageInternal([0xB0, 46, 0]);
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    app.ui.tickSampleEditor();
    assert.equal(app.ui.s.view, 'trim', 'playing the focused bank keeps its current editor');
});

test('Left/Right page loopers in both editors and scroll only when looper pads are off', () => {
    for (const view of ['trim', 'chop']) {
        const app = makeUi(true);
        boot(app); attachWaveFile(app);
        app.ui.openSampleEditor(view);
        app.ui.tickSampleEditor();
        app.ui.sampleWave.changeZoom(1, 0.5);
        const from = app.ui.sampleWave.model().from;
        app.ui.s.loopPadMode = true;
        app.ui.s.loopPadPage = 0;
        app.ui.onMidiMessageInternal([0xB0, 45, 127]);
        assert.equal(app.ui.s.loopPadPage, 1, view + ': Right advances the looper view');
        assert.equal(app.ui.sampleWave.model().from, from, 'looper navigation does not scroll the waveform');
        app.ui.onMidiMessageInternal([0xB0, 44, 127]);
        assert.equal(app.ui.s.loopPadPage, 0, view + ': Left returns to the previous looper view');
        assert.equal(app.ui.s.view, view, 'looper navigation keeps the editor open');
        app.ui.s.loopPadMode = false;
        app.ui.onMidiMessageInternal([0xB0, 45, 127]);
        assert.ok(app.ui.sampleWave.model().from > from, 'Right still scrolls with looper pads off');
    }
});

test('Jog press in Trim and CHOP opens the sample browser for the current pad and bank', () => {
    for (const [view, sec] of [['trim', 1], ['chop', 0]]) {
        const app = makeUi(true);
        boot(app); attachWaveFile(app);
        app.ui.s.focusedSection = sec;
        app.ui.s.selectedSlice = sec * 16 + 5;
        app.ui.s.sections[sec].currentBank = 2;
        app.ui.openSampleEditor(view);
        app.ui.tickSampleEditor();
        const before = app.writes.length;
        app.ui.onMidiMessageInternal([0xB0, 3, 127]);
        app.ui.onMidiMessageInternal([0xB0, 3, 0]);
        assert.equal(app.ui.s.view, 'browser', view + ': Jog opens the browser');
        assert.equal(app.ui.s.browserMode, 'samples');
        assert.equal(app.ui.s.focusedSection, sec);
        assert.equal(app.ui.s.selectedSlice, sec * 16 + 5);
        assert.equal(app.ui.s.sections[sec].currentBank, 2);
        assert.equal(app.ui.s.browserAssignMode, 'auto', 'main-screen sample assignment rules are preserved');
        assert.equal(app.writes.slice(before).some(([key]) => key === 'pad_note_on' || key === 'pad_note_off'), false,
            'Jog press/release does not trigger or release a sampler voice');
        assert.equal(app.ui.s.bankEditorView[sec][2], view, 'opening the browser preserves the saved editor mode');
    }
});

test('CHOP marks the chosen pad without filling the preceding pads', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    assert.equal(app.ui.s.view, 'chop');
    const bank = app.ui.s.sections[0].banks[0];
    const empty = bank.manualSliceStarts.slice();
    const randomMap = bank.sliceStarts.slice();
    assert.equal(empty[0], 0);
    assert.ok(empty.slice(1).every((v) => v === empty[16]),
        'CHOP starts with no internal cues');
    assert.equal(app.ui.chopCuePadLit(bank, 0), true, 'P1 is lit in CHOP');
    assert.equal(app.ui.chopCuePadLit(bank, 1), false, 'unmarked pads stay dark');
    const ledColor = (note) => {
        app.ui.rebuildLedQueue();
        const entry = app.ui.s.ledQueue.find(([n]) => n === note);
        return entry ? entry[1] : -1;
    };
    const p1Color = ledColor(68);
    assert.notEqual(p1Color, 0, 'P1 LED is on');
    assert.equal(ledColor(69), 0, 'unmarked pad LED is off');

    app.ui.onMidiMessageInternal([0xB0, 49, 127]);
    assert.equal(app.ui.s.lazyChopActive, false, 'Shift alone does not start playback');
    assert.equal(app.writes.some(([key]) => key === 'preview_play'), false);
    app.ui.onMidiMessageInternal([0xB0, 49, 0]);
    Object.assign(bank.slots[0], { pitch: 0, startTrim: 0, endTrim: 0, reverse: 0, loop: 0 });
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    assert.ok(app.ui.s.activePadPress['68'], 'P1 uses the normal sampler voice');
    assert.deepEqual(bank.manualSliceStarts, empty, 'playing a pad must not mark');
    assert.equal(app.ui.s.lazyChopActive, true);
    app.ui.onMidiMessageInternal([0xB0, 49, 127]);
    app.ui.s.lazyChopStartedMs -= 500;
    const noteCount = app.writes.filter(([key]) => key === 'pad_note_on').length;
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(app.writes.filter(([key]) => key === 'pad_note_on').length, noteCount,
        'Shift+pad marks without triggering another voice');
    const manual = bank.manualSliceStarts;
    const total = manual[16];
    assert.equal(manual.length, 17);
    assert.equal(manual[0], 0, 'P1 stays at the sample start');
    assert.ok(manual[4] > 0 && manual[4] < total, 'P5 gets the chosen cue');
    assert.equal(manual[1], manual[4], 'P2 is empty before P5');
    assert.equal(manual[2], manual[4], 'P3 is empty before P5');
    assert.equal(manual[3], manual[4], 'P4 is empty before P5');
    assert.equal(manual[5], total, 'P5 ends at the next cue');
    assert.equal(app.ui.s.lazyChopMarks, 1);
    assert.equal(bank.manualChopTouched, 1);
    assert.equal(app.ui.chopCuePadLit(bank, 1), false, 'P2 stays dark');
    assert.equal(app.ui.chopCuePadLit(bank, 4), true, 'P5 lights up');
    assert.equal(app.ui.chopCuePadLit(bank, 5), false, 'P6 stays dark');
    app.ui.s.transportTicks += 10000;
    assert.equal(ledColor(76), p1Color, 'P5 uses the bank color');
    assert.equal(ledColor(71), 0, 'P4 stays dark');

    app.ui.s.lazyChopStartedMs -= 250;
    app.ui.onMidiMessageInternal([0x90, 79, 127]);
    const marked = bank.manualSliceStarts;
    const p5Cue = marked[4];
    assert.ok(marked[7] > marked[4] && marked[7] < total, 'P8 gets the next chosen cue');
    assert.equal(marked[4], p5Cue, 'P5 cue is not moved');
    assert.equal(marked[5], marked[7], 'P5 ends at P8');
    assert.equal(marked[6], marked[7], 'P6 is empty before P8');
    assert.equal(app.ui.s.lazyChopMarks, 2);
    assert.equal(app.ui.chopCuePadLit(bank, 4), true, 'P5 stays lit');
    assert.equal(app.ui.chopCuePadLit(bank, 7), true, 'P8 lights up');
    assert.equal(app.ui.chopCuePadLit(bank, 6), false, 'P7 stays dark');
    assert.deepEqual(bank.sliceStarts, randomMap, 'manual marks must not rewrite the random map');
    app.ui.onMidiMessageInternal([0xB0, 49, 0]);
    assert.equal(app.ui.s.lazyChopActive, true, 'releasing Shift does not stop pad playback');
    const notesBefore = app.writes.filter(([key]) => key === 'pad_note_on').length;
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.ok(app.ui.s.activePadPress['76'], 'marked pads play their chops');
    assert.equal(app.writes.filter(([key]) => key === 'pad_note_on').length, notesBefore + 1);
    assert.equal(app.writes.some(([key]) => key === 'preview_play'), false,
        'CHOP uses sampler voices rather than the full-file preview');

    const saved = app.ui.serializeSession();
    assert.deepEqual(saved.sections[0].banks[0].manualSliceStarts, marked,
        'manual lazy chops must be saved with the project');
    assert.equal(saved.sections[0].banks[0].manualChopTouched, 1,
        'manual CHOP edits are marked as touched');
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    const start = marked[0];
    app.ui.adjustEditorEdge('start', 1);
    assert.equal(app.ui.s.sections[0].banks[0].manualSliceStarts[0], start + 44,
        'the first pad start is manually adjustable');
});

test('CHOP erase empties only the chosen cue', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    const bank = app.ui.s.sections[0].banks[0];
    const total = 44100, t = 4000, u = 8000;
    const starts = [0, t, t, t, t, u, u, u, total, total, total, total, total, total, total, total, total];
    bank.manualSliceStarts = starts.slice();
    const randomMap = bank.sliceStarts.slice();
    assert.equal(app.ui.chopCuePadLit(bank, 4), true, 'P5 is a cue');
    assert.equal(app.ui.chopCuePadLit(bank, 7), true, 'P8 is a cue');
    assert.equal(app.ui.chopCuePadLit(bank, 3), false, 'P4 is empty');

    app.ui.s.deleteHeld = true;
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.deepEqual(bank.manualSliceStarts, starts, 'other source pads must not erase the focused bank');
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(bank.manualSliceStarts[0], 0, 'P1 stays anchored at the sample start');
    assert.equal(bank.manualSliceStarts[1], u, 'empty pads before P5 stay empty');
    assert.equal(bank.manualSliceStarts[4], u, 'P5 becomes empty');
    assert.equal(bank.manualSliceStarts[5], u, 'P5 end stays at P8');
    assert.equal(bank.manualSliceStarts[7], u, 'P8 start is unchanged');
    assert.equal(bank.manualSliceStarts[8], total, 'P8 end is unchanged');
    assert.equal(app.ui.chopCuePadLit(bank, 3), false, 'P4 is not repopulated');
    assert.equal(app.ui.chopCuePadLit(bank, 4), false, 'erased P5 goes dark');
    assert.equal(app.ui.chopCuePadLit(bank, 6), false, 'P7 stays empty');
    assert.equal(app.ui.chopCuePadLit(bank, 7), true, 'P8 stays lit');
    assert.equal(bank.manualChopTouched, 1);
    assert.deepEqual(bank.sliceStarts, randomMap, 'erasing a cue must not rewrite the random map');

    const afterErase = bank.manualSliceStarts.slice();
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.deepEqual(bank.manualSliceStarts, afterErase, 'erasing an empty cue is a no-op');
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    assert.deepEqual(bank.manualSliceStarts, afterErase, 'P1 stays anchored');
    app.ui.s.deleteHeld = false;
});

test('the screen follows right drums without changing the left CHOP bank mode', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    assert.equal(app.ui.s.view, 'chop');
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.equal(app.ui.s.focusedSection, 1, 'controls target the displayed drum');
    assert.equal(app.ui.s.selectedSlice, 16, 'the played drum is displayed');
    assert.ok(app.writes.some(([key, value]) =>
        key === 'pad_note_on' && String(value).startsWith('72:')), 'the other section still plays');
    app.ui.tickSampleEditor();
    assert.equal(app.ui.s.view, 'trim', 'the screen displays the drum editor');
    assert.equal(app.ui.s.bankEditorView[0][0], 'chop', 'left playback mode is independent of the screen');
    assert.equal(app.ui.s.residentChopMaps[0][0], true);
    app.ui.onMidiMessageInternal([0x80, 72, 0]);
});

test('loop toggles follow the played pad without changing the other bank mode', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    app.ui.s.sections[1].banks[0].slots[0].loop = 1;
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.equal(app.ui.s.view, 'trim');
    assert.equal(app.ui.s.focusedSection, 1);
    app.advanceMs(12);
    app.ui.onMidiMessageInternal([0x80, 72, 0]);
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.equal(app.ui.s.view, 'trim', 'stopping a loop still displays that drum');
    assert.equal(app.ui.s.selectedSlice, 16);
    assert.equal(app.ui.s.bankEditorView[0][0], 'chop');
    app.ui.onMidiMessageInternal([0x90, 24, 127]);
    assert.equal(app.ui.s.focusedSection, 1, 'bank selection explicitly changes focus');
    assert.equal(app.ui.s.view, 'trim');
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    assert.equal(app.ui.s.focusedSection, 0, 'the display follows the played left chop');
    assert.equal(app.ui.s.view, 'chop');
    assert.equal(app.ui.s.bankEditorView[1][0], 'main', 'default drum mode is not rewritten by display following');
    app.ui.onMidiMessageInternal([0x90, 16, 127]);
    assert.equal(app.ui.s.view, 'chop', 'explicit left bank selection restores its CHOP mode');
});

test('left and right sections remember independent editor modes', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    assert.equal(app.ui.s.view, 'chop');

    app.ui.onMidiMessageInternal([0x90, 24, 127]);
    assert.equal(app.ui.s.focusedSection, 1, 'step button focuses the right section');
    assert.equal(app.ui.s.view, 'trim', 'the right section opens in Trim');

    app.ui.onMidiMessageInternal([0x90, 16, 127]);
    assert.equal(app.ui.s.focusedSection, 0, 'step button focuses the left section');
    assert.equal(app.ui.s.view, 'chop', 'the left section returns to CHOP');
});

test('alternating chops and drums emits only note traffic without reopening editors', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    const bank = app.ui.s.sections[0].banks[0];
    bank.manualSliceStarts = [0, 10000, 10000, 10000, 10000, ...Array(12).fill(44100)];
    Object.assign(bank.slots[4], { loop: 0, pitch: 0, reverse: 0, startTrim: 0, endTrim: 0 });
    app.ui.s.sections[1].banks[0].slots[0].loop = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    const map = bank.manualSliceStarts.slice();
    const modes = JSON.stringify(app.ui.s.bankEditorView);
    const screenAtNote = [];
    const send = app.context.host_module_set_param;
    app.context.host_module_set_param = (key, value) => {
        if (key === 'pad_note_on') screenAtNote.push(app.ui.s.view);
        return send(key, value);
    };
    let waveformWork = 0;
    const target = app.ui.sampleWave.target;
    const scan = app.ui.sampleWave.tick;
    app.ui.sampleWave.target = (...args) => { waveformWork++; return target(...args); };
    app.ui.sampleWave.tick = (...args) => { waveformWork++; return scan(...args); };
    const start = app.writes.length;
    for (let i = 0; i < 16; i++) {
        app.ui.onMidiMessageInternal([0x90, 72, 127]);
        assert.equal(app.ui.s.view, 'trim', 'right drum is displayed in Trim');
        assert.equal(app.ui.s.residentChopMaps[0][0], true, 'drums do not unload the left chop map');
        app.ui.tickSampleEditor();
        app.advanceMs(12);
        app.ui.onMidiMessageInternal([0x80, 72, 0]);
        app.ui.onMidiMessageInternal([0x90, 76, 127]);
        assert.equal(app.ui.s.view, 'chop');
        assert.equal(app.ui.s.lazyChopActive, true, 'cached source metadata starts cue tracking immediately');
        app.ui.tickSampleEditor();
        app.advanceMs(12);
        app.ui.onMidiMessageInternal([0x80, 76, 0]);
    }
    const traffic = app.writes.slice(start);
    assert.equal(traffic.filter(([key]) => key === 'pad_note_on').length, 32);
    assert.ok(traffic.every(([key]) => key === 'pad_note_on' || key === 'pad_note_off'),
        'no cursor sync, map restore, or other setup writes on alternating hits');
    assert.equal(waveformWork, 0, 'waveform I/O is deferred while hits are arriving');
    assert.deepEqual(bank.manualSliceStarts, map);
    assert.equal(JSON.stringify(app.ui.s.bankEditorView), modes, 'following pads never rewrites saved bank modes');
    assert.equal(screenAtNote.length, 32);
    for (let i = 0; i < screenAtNote.length; i++) {
        assert.equal(screenAtNote[i], i % 2 === 0 ? 'chop' : 'trim',
            'the note is delivered before the display follows it');
    }
});

test('knobs edit the displayed drum or chop while both bank modes and chop LEDs remain independent', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    const left = app.ui.s.sections[0].banks[0];
    const right = app.ui.s.sections[1].banks[0];
    left.manualSliceStarts = [0, 10000, 10000, 10000, 10000, ...Array(12).fill(44100)];
    left.slots[4].loop = 0;
    right.slots[0].loop = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    const cuts = left.manualSliceStarts.slice();
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    app.advanceMs(50);
    app.ui.tickSampleEditor();
    app.ui.handleParamKnob(73, 1);
    assert.equal(right.slots[0].startTrim, 1, 'K3 edits the displayed right drum');
    assert.deepEqual(left.manualSliceStarts, cuts, 'editing drums leaves the chop map alone');
    app.ui.rebuildLedQueue();
    const led = note => app.ui.s.ledQueue.find(([n]) => n === note)[1];
    assert.notEqual(led(68), 0, 'left P1 stays lit while displaying right drums');
    assert.equal(led(69), 0, 'left empty pads stay dark while displaying drums');
    assert.notEqual(led(76), 0, 'left marked chops stay lit');
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    app.advanceMs(50);
    app.ui.tickSampleEditor();
    app.ui.handleParamKnob(73, 1);
    assert.equal(left.manualSliceStarts[4], cuts[4] + 44, 'K3 now edits the displayed chop');
    assert.equal(right.slots[0].startTrim, 1);
    assert.equal(app.ui.s.bankEditorView[0][0], 'chop');
    assert.equal(app.ui.s.residentChopMaps[0][0], true);
});

test('empty CHOP pads mark directly, including after playing drums on the other side', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    const bank = app.ui.s.sections[0].banks[0];
    Object.assign(bank.slots[0], { loop: 0, pitch: 0, reverse: 0, startTrim: 0, endTrim: 0 });
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(app.ui.chopCuePadLit(bank, 4), false, 'no playback means no invented cue');
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    app.ui.s.lazyChopStartedMs -= 250;
    const started = app.ui.s.lazyChopStartedMs;
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.equal(app.ui.s.lazyChopStartedMs, started, 'right drums preserve left cue tracking');
    const notes = app.writes.filter(([key]) => key === 'pad_note_on').length;
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(app.ui.chopCuePadLit(bank, 4), true, 'an empty pad marks without Shift');
    assert.equal(app.writes.filter(([key]) => key === 'pad_note_on').length, notes,
        'creating a cue does not interrupt playback with a new voice');
    const first = bank.manualSliceStarts[4];
    app.advanceMs(12);
    app.ui.onMidiMessageInternal([0x90, 72, 127]);
    assert.equal(app.ui.s.view, 'trim');
    app.ui.s.lazyChopStartedMs -= 100;
    app.ui.onMidiMessageInternal([0xB0, 49, 127]);
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(app.ui.s.view, 'chop', 'Shift+left pad routes to CHOP even while displaying a right drum');
    assert.ok(bank.manualSliceStarts[4] > first, 'Shift+pad re-marks an existing cue');
    app.ui.onMidiMessageInternal([0xB0, 49, 0]);
    app.ui.onMidiMessageInternal([0x90, 76, 127]);
    assert.equal(app.writes.filter(([key]) => key === 'pad_note_on').length, notes + 2,
        'the now-marked pad plays normally');
});

test('playing a pad from main opens its remembered bank editor before triggering', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();
    const slot = app.ui.s.sections[0].banks[0].slots[0];
    const settings = JSON.stringify(slot);
    app.ui.handleBackButton();
    assert.equal(app.ui.s.view, 'main');
    app.ui.onMidiMessageInternal([0x90, 68, 127]);
    assert.equal(app.ui.s.view, 'chop');
    assert.ok(app.ui.s.activePadPress['68']);
    assert.equal(JSON.stringify(slot), settings, 'normal envelope, pitch and gate settings are preserved');
    app.ui.onMidiMessageInternal([0xB0, 49, 127]);
    app.ui.onMidiMessageInternal([0xB0, 49, 0]);
    assert.equal(app.writes.some(([key]) => key === 'preview_play'), false);
});

test('each bank remembers its own editor mode and saves it with the project', () => {
    const app = makeUi(true);
    boot(app); attachWaveFile(app);
    app.ui.s.selectedSlice = 0; app.ui.s.focusedSection = 0;
    app.ui.openSampleEditor('chop');
    app.ui.tickSampleEditor();

    app.ui.onMidiMessageInternal([0x90, 17, 127]);
    assert.equal(app.ui.s.sections[0].currentBank, 1);
    assert.equal(app.ui.s.view, 'trim', 'a new bank opens in Trim');
    app.ui.onMidiMessageInternal([0x90, 16, 127]);
    assert.equal(app.ui.s.view, 'chop', 'bank 1 returns to CHOP');
    app.ui.onMidiMessageInternal([0x90, 17, 127]);
    assert.equal(app.ui.s.view, 'trim', 'bank 2 keeps its own mode');

    const saved = app.ui.serializeSession();
    assert.equal(saved.bankEditorView[0].slice(0, 2).join(','), 'chop,trim');

    const restored = makeUi(true);
    boot(restored); attachWaveFile(restored);
    restored.ui.applyParsedSession(saved, true, 'editor modes');
    restored.ui.s.selectedSlice = 0;
    restored.ui.s.focusedSection = 0;
    restored.ui.openSampleEditor('trim');
    restored.ui.tickSampleEditor();
    restored.ui.onMidiMessageInternal([0x90, 16, 127]);
    assert.equal(restored.ui.s.view, 'chop', 'saved bank 1 mode is restored');
    restored.ui.onMidiMessageInternal([0x90, 17, 127]);
    assert.equal(restored.ui.s.view, 'trim', 'saved bank 2 mode is restored');
});

test('legacy CHOP maps seeded from random do not overwrite the independent map', () => {
    const app = makeUi(true); boot(app);
    const payload = app.ui.serializeSession();
    const legacyMap = Array.from({ length: 17 }, (_, i) => i * 1000);
    const seeded = payload.sections[0].banks[0];
    seeded.sliceStarts = legacyMap.slice();
    seeded.manualSliceStarts = legacyMap.slice();
    delete seeded.manualChopTouched;
    app.ui.applyParsedSession(payload, true, 'legacy seeded');
    assert.equal(app.ui.s.sections[0].banks[0].manualSliceStarts.length, 0,
        'an untouched legacy copy of the random map is discarded');
    assert.equal(app.ui.s.sections[0].banks[0].manualChopTouched, 0);

    const worked = payload.sections[0].banks[1];
    worked.sliceStarts = legacyMap.slice();
    worked.manualSliceStarts = legacyMap.map((v, i) => i ? v + 1 : 0);
    delete worked.manualChopTouched;
    app.ui.applyParsedSession(payload, true, 'legacy edited');
    assert.equal(app.ui.s.sections[0].banks[1].manualSliceStarts.length, 17,
        'a manually edited legacy CHOP map is preserved');
    assert.equal(app.ui.s.sections[0].banks[1].manualChopTouched, 1);
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
