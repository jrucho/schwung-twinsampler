// Emit the real UI's parameter writes for replay by editor_control_probe.c.
import fs from 'node:fs';
import vm from 'node:vm';
import { createParamTransport } from '../twinsampler/param_transport.mjs';
import { makeWaveIo, createWaveform, sourceSliceFrames, moveSliceBoundary } from '../twinsampler/waveform.mjs';
import { fxPresetRow, fxPresetName, fxPresetDisplayName } from '../twinsampler/fx_presets.mjs';

const sample = process.argv[2];
const live = process.argv[3] === 'live';
const firstStartMs = Number(process.env.TS_FIRST_START_MS || 1000);
const testFrames = Math.max(88200, Math.round((firstStartMs + 1000) * 44.1));
if (!sample) throw Error('Usage: node editor_control_trace.mjs /remote/test-tone.wav');
const source = fs.readFileSync(new URL('../twinsampler/ui_chain.js', import.meta.url), 'utf8');
const wav = Buffer.alloc(44 + testFrames * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const emit = (key, value = '') => process.stdout.write(key + '\t' + value + '\n');

for (const [view, sec] of [['trim', 0], ['chop', 0], ['trim', 1]]) {
    for (const bank of [0, 7]) for (const slot of [0, 3]) {
        const controls = ['baseline', 'pitch', 'gain', 'attack', 'decay'];
        if (view === 'chop' && slot === 0) controls.push('start', 'start-reset', 'start-restore');
        for (const control of controls) {
            if (process.env.TS_CONTROL_ONLY && !control.startsWith(process.env.TS_CONTROL_ONLY)) continue;
            const label = `${view}-S${sec + 1}-B${bank + 1}-P${slot + 1}`;
            emit('@case', label + '\t' + control);
            let pos = 0, clock = 0;
            const context = vm.createContext({
                createParamTransport, makeWaveIo, createWaveform, sourceSliceFrames, moveSliceBoundary,
                fxPresetRow, fxPresetName, fxPresetDisplayName,
                os: { stat: () => [{ mode: 0o040755 }, 0], open: () => { pos = 0; return 1; },
                    close() {}, seek(fd, offset, whence) { pos = whence === 2 ? wav.length + offset : offset; return pos; },
                    read(fd, buffer, offset, count) {
                        const n = Math.min(count, wav.length - pos);
                        new Uint8Array(buffer, offset, n).set(wav.subarray(pos, pos + n)); pos += n; return n;
                    } },
                moveConstants: {}, moveInputFilter: { decodeDelta: v => v < 64 ? v : v - 128 },
                Date: class extends Date { static now() { return clock; } }, console: { log() {} },
                host_module_get_param: () => undefined,
                host_module_set_param: (k, v) => { clock++; emit(k, v); },
                host_module_set_param_blocking: (k, v) => { clock++; emit(k, v); },
                host_read_file() {}, host_write_file() {},
                move_midi_internal_send() {}, move_midi_external_send() {}
            });
            vm.runInContext(source.replace(/^import .*;\r?$/gm, '') + `
                draw = () => {}; forceLedRefreshNow = () => {};
                globalThis.ui = { s, spb, setSourcePath, setSlotPath, setSelectedSlice,
                    setSelectedSliceRealtime, setSlotAttack, setSlotDecay, setSlotGain,
                    openSampleEditor, tickSampleEditor, onMidiMessageInternal };
            `, context);
            const ui = context.ui;
            ui.s.sections[sec].currentBank = bank;
            ui.spb('section_mode', sec + ':' + sec);
            ui.spb('section_bank', sec + ':' + bank);
            if (sec === 0) ui.setSourcePath(sec, bank, sample, true);
            else ui.setSlotPath(sec, bank, slot, sample, true);
            if (sec === 0) ui.s.sections[sec].banks[bank].sliceStarts =
                Array.from({ length: 17 }, (_, i) => Math.round(i * testFrames / 16));
            ui.setSlotAttack(sec, bank, slot, 1, true);
            ui.setSlotDecay(sec, bank, slot, 1000, true);
            ui.setSlotGain(sec, bank, slot, 1, true);
            ui.setSelectedSlice(sec * 16 + slot, true);
            if (view === 'chop') {
                const b = ui.s.sections[sec].banks[bank];
                b.manualSliceStarts = control.startsWith('start') ? [0, ...Array(16).fill(testFrames)]
                    : Array.from({ length: 17 }, (_, i) => Math.round(i * 88200 / 16));
                b.manualChopTouched = 1;
            }
            ui.openSampleEditor(view); ui.tickSampleEditor();
            // Pad following deliberately leaves the DSP edit cursor on the other grid.
            ui.setSelectedSlice((1 - sec) * 16 + 2, true);
            ui.setSelectedSliceRealtime(sec * 16 + slot);
            const note = 68 + Math.floor(slot / 4) * 8 + sec * 4 + slot % 4;
            if (live) {
                ui.onMidiMessageInternal([0x90, note, 127]);
                emit('@prime');
            }
            const knob = { pitch: [76, 24], gain: [77, 113], attack: [71, 40], decay: [72, 65] }[control];
            if (knob) ui.onMidiMessageInternal([0xB0, ...knob]);
            if (control.startsWith('start')) {
                ui.onMidiMessageInternal([0xB0, 49, 127]);
                for (let ticks = Math.round(firstStartMs / 10); ticks > 0; ticks -= 63)
                    ui.onMidiMessageInternal([0xB0, 73, Math.min(63, ticks)]);
                ui.onMidiMessageInternal([0xB0, 49, 0]);
                if (control !== 'start') {
                    ui.openSampleEditor('trim');
                    if (control === 'start-restore') ui.openSampleEditor('chop');
                    if (live) { ui.onMidiMessageInternal([0x90, note, 127]); emit('@prime'); }
                }
            }
            if (!live) { emit('pad_note_on', note + ':127'); emit('@prime'); }
            clock += 250;
            if (live) ui.onMidiMessageInternal([0x80, note, 0]);
            else emit('pad_note_off', String(note));
            if (live && sec === 1) {
                // Drum trigger voices keep their envelope until completion;
                // changes must be audible on the next hit, without doubling.
                emit('@drain'); clock += 3000;
                ui.onMidiMessageInternal([0x90, note, 127]);
                emit('@prime');
            }
            emit('@measure', control);
        }
    }
}
