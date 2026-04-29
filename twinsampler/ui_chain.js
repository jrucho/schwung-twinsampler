/*
 * TwinSampler ui_chain (Overtake)
 *
 * Core spec:
 * - 2 independent 4x4 sections
 * - 8 banks per section
 * - Section mode per grid: single-source or per-slot
 * - Per-slot sample assignment + direct recording to focused slot
 * - Session save/load for full 2x8x16 state
 */

import * as os from 'os';
import * as moveConstants from '/data/UserData/schwung/shared/constants.mjs';
import * as moveInputFilter from '/data/UserData/schwung/shared/input_filter.mjs';

function pickConst(name, fallback) {
    const v = moveConstants[name];
    return Number.isFinite(v) ? v : fallback;
}

const MoveMainKnob = pickConst('MoveMainKnob', 14);
const MoveMainButton = pickConst('MoveMainButton', 3);
const MoveKnob1 = pickConst('MoveKnob1', 71);
const MoveKnob2 = pickConst('MoveKnob2', 72);
const MoveKnob3 = pickConst('MoveKnob3', 73);
const MoveKnob4 = pickConst('MoveKnob4', 74);
const MoveKnob5 = pickConst('MoveKnob5', 75);
const MoveKnob6 = pickConst('MoveKnob6', 76);
const MoveKnob7 = pickConst('MoveKnob7', 77);
const MoveKnob8 = pickConst('MoveKnob8', 78);
const MoveShift = pickConst('MoveShift', 49);
const MoveMenu = pickConst('MoveMenu', 50);
const MoveCopy = pickConst('MoveCopy', 60);
const MoveCapture = pickConst('MoveCapture', 52);
const MoveRec = pickConst('MoveRec', 86);
const MoveRecord = pickConst('MoveRecord', 118);
const MoveLoop = pickConst('MoveLoop', 87);
const MovePlay = pickConst('MovePlay', pickConst('MoveTransportPlay', pickConst('MovePlayPause', 85)));
const MoveMute = pickConst('MoveMute', 88);
const MoveUndo = pickConst('MoveUndo', 56);
const MoveDelete = pickConst('MoveDelete', 119);
const MoveMaster = pickConst('MoveMaster', 79);
const MoveMasterTouch = pickConst('MoveMasterTouch', 8);
const MoveArrowLeft = pickConst('MoveArrowLeft', pickConst('MoveLeft', 44));
const MoveArrowRight = pickConst('MoveArrowRight', pickConst('MoveRight', 45));
const MoveArrowUp = pickConst('MoveArrowUp', pickConst('MoveUp', 46));
const MoveArrowDown = pickConst('MoveArrowDown', pickConst('MoveDown', 47));
const Black = pickConst('Black', 0);
const BrightRed = pickConst('BrightRed', 127);
const OrangeRed = pickConst('OrangeRed', 9);
const Ochre = pickConst('Ochre', 8);
const AzureBlue = pickConst('AzureBlue', 47);
const RoyalBlue = pickConst('RoyalBlue', 48);
const Cyan = pickConst('Cyan', 11);
const ElectricViolet = pickConst('ElectricViolet', 53);
const Violet = pickConst('Violet', 52);
const BrightPink = pickConst('BrightPink', 120);
const Rose = pickConst('Rose', 118);
const BrightGreen = pickConst('BrightGreen', 21);
const ForestGreen = pickConst('ForestGreen', 3);
const VividYellow = pickConst('VividYellow', 15);
const Mustard = pickConst('Mustard', 14);

const decodeDelta = (typeof moveInputFilter.decodeDelta === 'function')
    ? moveInputFilter.decodeDelta
    : function(value) {
        if (value === 0) return 0;
        if (value >= 1 && value <= 63) return 1;
        if (value >= 65 && value <= 127) return -1;
        return 0;
    };

const setLED = (typeof moveInputFilter.setLED === 'function')
    ? moveInputFilter.setLED
    : function(note, color) {
        try {
            if (typeof move_midi_internal_send === 'function') {
                move_midi_internal_send([0x09, 0x90, note, color]);
            }
        } catch (e) {}
    };

const setButtonLED = (typeof moveInputFilter.setButtonLED === 'function')
    ? moveInputFilter.setButtonLED
    : function(cc, color) {
        try {
            if (typeof move_midi_internal_send === 'function') {
                move_midi_internal_send([0x0B, 0xB0, cc, color]);
            }
        } catch (e) {}
    };

const USE_STEP_BANKS = true; /* overtake: step buttons select banks */
const LEFT_GRID_ONLY = false; /* dual-grid mode: left and right 4x4 sections active */
const MODULE_FLAVOR = '';

const SAMPLES_DIR = '/data/UserData/UserLibrary/Samples';
const RECORDED_SAMPLES_ROOT = SAMPLES_DIR + '/TwinSamplerRecorded';
const SESSIONS_DIR = '/data/UserData/UserLibrary/TwinSamplerSessions';
const LEGACY_SESSION_FILE = '/data/UserData/UserLibrary/twinsampler-session-v2.json';
const AUTOSAVE_SESSION_FILE = '/data/UserData/UserLibrary/twinsampler-autosave-v1.json';
const DEFAULT_SESSION_NAME = 'SESSION01';
const INIT_SESSION_NAME = 'INIT';
const SESSION_NAME_MAX = 12;
const SESSION_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const AUTOSAVE_DELAY_TICKS = 96;
const REALTIME_NONBLOCKING = true;
const HISTORY_MAX = 80;

const GRID_SIZE = 16;
const GRID_COUNT = 2;
const BANK_COUNT = 8;
const TOTAL_PADS = GRID_SIZE * GRID_COUNT;
const MIDI_NOTE_BASE = 36; /* C1 in Drum Rack convention */
const MIDI_FIXED_NOTES = Array.from({ length: GRID_SIZE }, (_, i) => MIDI_NOTE_BASE + i);
const MIDI_OUT_POLY_AFTERTOUCH = false;

const PAD_NOTE_MIN = 68;
const PAD_NOTE_MAX = 99;
const PAD_COLS = 8;
const PAD_ROWS = 4;
const SECTION_COLS = 4;
const STEP_NOTE_MIN = 16;
const STEP_NOTE_MAX = 31;

const MODE_SINGLE = 0;
const MODE_PER_SLOT = 1;
const SOURCE_CHOP_COUNT = 16;
const CHOP_OPTIONS = [SOURCE_CHOP_COUNT];

const LOOP_LABELS = ['Off', 'Loop', 'Ping'];
const FILTER_TYPES = ['Low-pass', 'High-pass', 'Band-pass', 'Res LP'];
const EMULATION_PRESETS = ['Clean', 'Punchy', 'Dusty', 'Vintage'];
const DSP_FX_COUNT = 16;
const FX_EFFECT_COUNT = 9;
const FX_PARAM_COUNT = 8;
const FX_EFFECT_NAMES = [
    '404 VinylSim',
    'Isolator',
    'Filter + Drive',
    'Tape Echo',
    'Lo-fi',
    'Compressor',
    'Chorus',
    'Resonator',
    'DJFX Looper'
];
const FX_DSP_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const LEGACY_FX_DSP_INDEX = [12, 4, 5, 6, 0, 1, 2, 3];
const FX_PAD_SLOT_MAP = [-1, -1, -1, -1, -1, -1, -1, 8, 0, 1, 2, 3, 4, 5, 6, 7];
const FX_PARAM_LABELS = [
    ['Preset', 'Age', 'Wow', 'Flutter', 'Noise', 'Wear', 'Tone', 'Out'],
    ['Preset', 'Low', 'Mid', 'High', 'Xover', 'Res', 'Drive', 'Out'],
    ['Preset', 'Cutoff', 'Res', 'Drive', 'Type', 'Env', 'Mix', 'Out'],
    ['Preset', 'Time', 'Feedback', 'Mix', 'Flutter', 'Tone', 'Duck', 'Out'],
    ['Preset', 'Bits', 'SampRate', 'Mix', 'Noise', 'Jitter', 'Tone', 'Out'],
    ['Preset', 'Amount', 'Thresh', 'Ratio', 'Attack', 'Release', 'Drive', 'Out'],
    ['Preset', 'Rate', 'Depth', 'Feedback', 'Mix', 'Mode', 'Stereo', 'Out'],
    ['Preset', 'Tune', 'Res', 'Mix', 'Drive', 'Spread', 'Low', 'High'],
    ['Preset', 'Length', 'Speed', 'LoopSw', 'Mix', 'Gate', 'Tone', 'Out']
];
const FX_PRESET_COUNT = 5;
const FX_PRESET_VALUES = [0.00, 0.25, 0.50, 0.75, 1.00];
const FX_PRESET_STRENGTH = [0.40, 0.65, 0.85, 1.00, 1.18];
const FX_DEFAULT_PARAMS = [
    [0.50, 0.52, 0.26, 0.18, 0.16, 0.32, 0.54, 0.86], /* 404 VinylSim */
    [0.50, 0.58, 0.58, 0.56, 0.50, 0.30, 0.20, 0.86], /* Isolator */
    [0.50, 0.62, 0.46, 0.42, 0.18, 0.16, 0.70, 0.82], /* Filter + Drive */
    [0.50, 0.45, 0.52, 0.42, 0.30, 0.58, 0.34, 0.82], /* Tape Echo */
    [0.50, 0.42, 0.34, 0.62, 0.16, 0.18, 0.50, 0.82], /* Lo-fi */
    [0.50, 0.68, 0.50, 0.70, 0.16, 0.42, 0.22, 0.82], /* Compressor */
    [0.50, 0.30, 0.54, 0.30, 0.52, 0.78, 0.62, 0.84], /* Chorus */
    [0.50, 0.46, 0.70, 0.58, 0.34, 0.54, 0.46, 0.58], /* Resonator */
    [0.50, 0.44, 0.75, 1.00, 0.90, 1.00, 0.50, 0.86]  /* DJFX Looper */
];
const FX_EFFECT_COLORS = [9, 21, 47, 15, 53, 120, 48, 45, 118];
function fxPresetValueFromIndex(idx) {
    const i = clampInt(idx, 0, FX_PRESET_COUNT - 1, 0);
    return FX_PRESET_VALUES[i];
}
function fxPresetIndexFromValue(value) {
    const v = clampFloat(value, 0.0, 1.0, 0.5);
    return clampInt(Math.round(v * (FX_PRESET_COUNT - 1)), 0, FX_PRESET_COUNT - 1, 2);
}
function fxSlotName(scope, effectIdx) {
    void scope;
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    return (Array.isArray(FX_EFFECT_NAMES) && FX_EFFECT_NAMES[idx]) ? FX_EFFECT_NAMES[idx] : ('FX' + (idx + 1));
}
function fxParamLabels(scope, effectIdx) {
    void scope;
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const labels = FX_PARAM_LABELS;
    return (Array.isArray(labels) && Array.isArray(labels[idx])) ? labels[idx] : null;
}
function fxDefaultParamRow(scope, effectIdx) {
    void scope;
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const rows = FX_DEFAULT_PARAMS;
    return Array.isArray(rows) ? rows[idx] : null;
}
function fxDspIndex(effectIdx, scope = 'bank') {
    void scope;
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const mapping = FX_DSP_INDEX;
    const mapped = Array.isArray(mapping) ? mapping[idx] : idx;
    return clampInt(mapped, 0, DSP_FX_COUNT - 1, idx);
}
function fxEffectFromPadSlot(slotIdx) {
    const slot = clampInt(slotIdx, 0, GRID_SIZE - 1, -1);
    if (slot < 0) return -1;
    return clampInt(FX_PAD_SLOT_MAP[slot], -1, FX_EFFECT_COUNT - 1, -1);
}
function fxPresetParams(effectIdx, presetIdx, scope = 'bank') {
    const fx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const pIdx = clampInt(presetIdx, 0, FX_PRESET_COUNT - 1, 2);
    const row = fxDefaultParamRow(scope, fx);
    const strength = clampFloat(FX_PRESET_STRENGTH[pIdx], 0.1, 2.0, 1.0);
    const params = Array.from({ length: FX_PARAM_COUNT }, (_p, paramIdx) => {
        if (paramIdx === 0) return fxPresetValueFromIndex(pIdx);
        const base = clampFloat(row ? row[paramIdx] : 0.5, 0.0, 1.0, 0.5);
        const shaped = 0.5 + (base - 0.5) * strength;
        return clampFloat(shaped, 0.0, 1.0, base);
    });
    params[0] = fxPresetValueFromIndex(pIdx);
    return params;
}
function applyPresetToFxState(effectIdx, eff, presetIdx, scope = 'bank') {
    if (!eff || typeof eff !== 'object') return;
    const p = fxPresetParams(effectIdx, presetIdx, scope);
    eff.params = p;
}
function normalizeFxParam(effectIdx, paramIdx, value, fallback = 0.5) {
    const p = clampInt(paramIdx, 0, FX_PARAM_COUNT - 1, 0);
    const v = clampFloat(value, 0.0, 1.0, fallback);
    if (p === 0) return fxPresetValueFromIndex(fxPresetIndexFromValue(v));
    return v;
}
function defaultFxParam(effectIdx, paramIdx, scope = 'bank') {
    const fx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const p = clampInt(paramIdx, 0, FX_PARAM_COUNT - 1, 0);
    const row = fxDefaultParamRow(scope, fx);
    const raw = Array.isArray(row) ? row[p] : 0.5;
    return normalizeFxParam(fx, p, raw, 0.5);
}
function fxLedColor(scope, effectIdx, enabled) {
    void scope;
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const full = FX_EFFECT_COLORS[idx] || 120;
    if (enabled) return full;
    const c = clampInt(full, 0, 127, 0);
    if (c <= 0) return 0;
    return clampInt(Math.round(c * 0.05), 1, 6, 1);
}
const STATUS_TICKS = 120;
const LEDS_PER_TICK = 8;
const PREVIEW_DEBOUNCE_MS = 250;
const SOURCE_PITCH_LIVE_RETRIGGER = true;
const RECORD_LED_BLINK_PERIOD_TICKS = 24;
const LED_RESYNC_INTERVAL_TICKS = 18;
const LED_RESYNC_PASSES = 3;
const LOOP_DOUBLE_PRESS_TICKS = 90;
const LOOP_ERASE_HOLD_TICKS = 36;
const LOOP_TOGGLE_HOLD_THRESHOLD_MS = 1000;
const STEP_FX_HOLD_THRESHOLD_MS = 1000;
const STEP_BANK_BLINK_PERIOD_TICKS = 12;
const PLAY_DOUBLE_PRESS_TICKS = 30;
const PAD_PRESS_FLASH_TICKS = 5;
const PAD_PRESS_LED_COLOR = 122; /* dim white */
const RECORD_ACK_TIMEOUT_TICKS = 72;
const RECORD_INTENT_WINDOW_TICKS = 48;
const RECORD_PATH_WAIT_TICKS = 120;
const MIDI_ECHO_SUPPRESS_WINDOW_MS = 35;
const MIDI_MIN_NOTE_LENGTH_MS = 8;
const MIDI_DUPLICATE_NOTE_ON_GUARD_MS = 2;
const COPY_TAP_MAX_TICKS = 48;
const BINARY_KNOB_TURN_THRESHOLD = 2;
const BINARY_KNOB_TOGGLE_COOLDOWN_MS = 160;
const BINARY_KNOB_TURN_IDLE_RESET_MS = 220;
const LOOP_PAD_NOTES = [96, 97, 98, 99]; /* top row, right 4 pads */
const LOOP_PAD_COLOR_OFF = Black;
const LOOP_PAD_COLOR_RECORD = BrightRed;
const LOOP_PAD_COLOR_PLAY = 21;
const LOOP_PAD_COLOR_OVERDUB = 9;
const LOOP_PAD_COLOR_STOPPED = 118;
const TRIM_STEP_FINE = 1.0;
const TRIM_STEP_COARSE = 5.0;
const SLOT_TRIM_MIN_MS = -600000.0;
const SLOT_TRIM_MAX_MS = 600000.0;
const SLOT_PARAM_REFRESH_TICKS_AFTER_LOAD = 24;
const SLOT_TRIM_REPLAY_TICKS_AFTER_LOAD = 36;
const DEFAULT_DECAY_MS = 500.0;
const SOURCE_MODE_DEFAULT_DECAY_MS = 10000.0;
const DECAY_MAX_MS = 600000.0;
const LOOPER_COUNT = 16;
const LOOPER_PAGE_SIZE = 4;
const TOP_ROW_SLOT_START = GRID_SIZE - SECTION_COLS;

function createLooperState() {
    return {
        state: 'empty', /* empty|recording|playing|overdub|stopped */
        events: [],
        quantized: 0,
        preQuantizeEvents: [],
        loopLengthMs: 0,
        recordStartMs: 0,
        playStartMs: 0,
        loopPosMs: 0,
        lastLoopPosMs: 0,
        layerStack: [],
        buttonHeld: false,
        buttonDownTick: -1,
        lastPressTick: -9999,
        eraseHoldTriggered: false,
        holdEraseArmed: false
    };
}

function createFxEffectState(effectIdx = 0, scope = 'bank') {
    const fx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const presetIdx = fxPresetIndexFromValue(defaultFxParam(fx, 0, scope));
    return {
        enabled: 0,
        params: fxPresetParams(fx, presetIdx, scope)
    };
}

function createFxEffectArray(scope = 'bank') {
    return Array.from({ length: FX_EFFECT_COUNT }, (_eff, idx) => createFxEffectState(idx, scope));
}
function fxSourceEntry(srcEffects, effectIdx, scope = 'bank') {
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    if (!Array.isArray(srcEffects) || !srcEffects.length) return null;
    if (srcEffects.length === FX_EFFECT_COUNT) return srcEffects[idx] || null;
    if (srcEffects.length === FX_EFFECT_COUNT - 1) return idx < srcEffects.length ? (srcEffects[idx] || null) : null;
    if (srcEffects.length >= DSP_FX_COUNT) {
        const mapped = fxDspIndex(idx, scope);
        return srcEffects[mapped] || null;
    }
    if (srcEffects.length === LEGACY_FX_DSP_INDEX.length) {
        const target = fxDspIndex(idx, scope);
        for (let legacyIdx = 0; legacyIdx < LEGACY_FX_DSP_INDEX.length; legacyIdx++) {
            if (LEGACY_FX_DSP_INDEX[legacyIdx] === target) return srcEffects[legacyIdx] || null;
        }
        return null;
    }
    return srcEffects[idx] || null;
}

const BANK_COLOR_SEQUENCE = [8, 15, 3, 21, 7, 31, 47, 1];
const COLOR_PALETTE = [120, 118, 8, 9, 11, 12, 14, 15, 16, 47, 48, 3, 7, 21, 1, 125, 127];
const PAD_COLOR_SEQUENCE = [-1].concat(COLOR_PALETTE);

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
}

function clampFloat(v, min, max, fallback) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
}

function clampMsTimestamp(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
}

function normalizeChopCount(v) {
    void v;
    return SOURCE_CHOP_COUNT;
}

function normalizeTransientSensitivity(v) {
    return clampInt(v, 0, 100, 50);
}

function chopIndex(v) {
    const c = normalizeChopCount(v);
    const i = CHOP_OPTIONS.indexOf(c);
    return i >= 0 ? i : 2;
}

function baseName(path) {
    if (!path) return '';
    const parts = String(path).split('/');
    return parts[parts.length - 1] || '';
}

function shortText(text, max = 21) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)) + '...';
}

function sectionFromSlice(slice) {
    return slice < GRID_SIZE ? 0 : 1;
}

function slotFromSlice(slice) {
    return slice % GRID_SIZE;
}

function sliceFromPadNote(note) {
    const idx = note - PAD_NOTE_MIN;
    if (idx < 0 || idx >= TOTAL_PADS) return -1;

    const row = Math.floor(idx / PAD_COLS);
    const col = idx % PAD_COLS;
    if (row < 0 || row >= PAD_ROWS) return -1;
    if (LEFT_GRID_ONLY && col >= SECTION_COLS) return -1;

    const sec = col < SECTION_COLS ? 0 : 1;
    const slot = row * SECTION_COLS + (col % SECTION_COLS);
    return sec * GRID_SIZE + slot;
}

function playableSliceFromPadNote(note) {
    /* Keep pad routing deterministic: never remap to legacy coordinates. */
    return sliceFromPadNote(note);
}

function dspSliceFromSecSlot(sec, slot) {
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sSlot = clampInt(slot, 0, GRID_SIZE - 1, 0);
    return sSec * GRID_SIZE + sSlot;
}

function dspSliceFromCustomSlice(slice) {
    const sec = sectionFromSlice(slice);
    const slot = slotFromSlice(slice);
    return dspSliceFromSecSlot(sec, slot);
}

function customSliceFromDspSlice(dspSlice) {
    return clampInt(dspSlice, 0, TOTAL_PADS - 1, 0);
}

function defaultBankColor(bankIdx) {
    return BANK_COLOR_SEQUENCE[clampInt(bankIdx, 0, BANK_COUNT - 1, 0) % BANK_COLOR_SEQUENCE.length];
}

function makeSlot() {
    return {
        path: '',
        attack: 5.0,
        decay: DEFAULT_DECAY_MS,
        startTrim: 0.0,
        endTrim: 0.0,
        gain: 1.0,
        pan: 0.0,
        pitch: 0.0,
        modeGate: 0,
        loop: 0,
        reverse: 0,
        color: -1,
        muted: 0
    };
}

function cloneSlot(s) {
    return {
        path: s.path,
        attack: s.attack,
        decay: s.decay,
        startTrim: s.startTrim,
        endTrim: s.endTrim,
        gain: s.gain,
        pan: s.pan,
        pitch: s.pitch,
        modeGate: s.modeGate,
        loop: s.loop,
        reverse: s.reverse ? 1 : 0,
        color: s.color,
        muted: s.muted ? 1 : 0
    };
}

function resetSlotSoundParamsToDefault(slot) {
    if (!slot || typeof slot !== 'object') return;
    const base = makeSlot();
    slot.attack = base.attack;
    slot.decay = base.decay;
    slot.startTrim = base.startTrim;
    slot.endTrim = base.endTrim;
    slot.gain = base.gain;
    slot.pan = base.pan;
    slot.pitch = base.pitch;
    slot.modeGate = base.modeGate;
    slot.loop = base.loop;
    slot.reverse = base.reverse;
}

function applySourceModeDefaultsToSlot(slot) {
    if (!slot || typeof slot !== 'object') return;
    slot.decay = SOURCE_MODE_DEFAULT_DECAY_MS;
}

function makeBank(bankIdx = 0) {
    const slots = [];
    for (let i = 0; i < GRID_SIZE; i++) slots.push(makeSlot());
    return {
        sourcePath: '',
        bankColor: defaultBankColor(bankIdx),
        chopCount: SOURCE_CHOP_COUNT,
        slicePage: 0,
        transientSensitivity: 50,
        sliceStarts: [],
        filterType: 0,
        filterValue: 0.5,
        emulationPreset: 0,
        fxEffects: createFxEffectArray('bank'),
        slots
    };
}

function cloneBank(b) {
    return {
        sourcePath: b.sourcePath,
        bankColor: b.bankColor,
        chopCount: normalizeChopCount(b.chopCount),
        slicePage: clampInt(b.slicePage, 0, 7, 0),
        transientSensitivity: normalizeTransientSensitivity(b.transientSensitivity),
        sliceStarts: Array.isArray(b.sliceStarts) ? b.sliceStarts.map((v) => clampInt(v, 0, 0x7fffffff, 0)) : [],
        filterType: clampInt(b.filterType, 0, FILTER_TYPES.length - 1, 0),
        filterValue: clampFloat(b.filterValue, 0.0, 1.0, 0.5),
        emulationPreset: clampInt(b.emulationPreset, 0, EMULATION_PRESETS.length - 1, 0),
        fxEffects: Array.from({ length: FX_EFFECT_COUNT }, (_, idx) => {
            const src = fxSourceEntry(b.fxEffects, idx, 'bank');
            return {
                enabled: clampInt(src && src.enabled, 0, 1, 0),
                params: Array.from(
                    { length: FX_PARAM_COUNT },
                    (_p, pIdx) => normalizeFxParam(idx, pIdx, src && Array.isArray(src.params) ? src.params[pIdx] : defaultFxParam(idx, pIdx, 'bank'), defaultFxParam(idx, pIdx, 'bank'))
                )
            };
        }),
        slots: b.slots.map((s) => cloneSlot(s))
    };
}

function makeSection(defaultMode) {
    const banks = [];
    for (let i = 0; i < BANK_COUNT; i++) banks.push(makeBank(i));
    if (clampInt(defaultMode, MODE_SINGLE, MODE_PER_SLOT, MODE_PER_SLOT) === MODE_SINGLE) {
        for (let b = 0; b < BANK_COUNT; b++) {
            for (let slot = 0; slot < GRID_SIZE; slot++) applySourceModeDefaultsToSlot(banks[b].slots[slot]);
        }
    }
    return {
        mode: defaultMode,
        currentBank: 0,
        banks
    };
}

function defaultPadModeGateForSectionMode(mode) {
    return clampInt(mode, MODE_SINGLE, MODE_PER_SLOT, MODE_PER_SLOT) === MODE_SINGLE ? 1 : 0;
}

const s = {
    view: 'main',
    dirty: true,

    shiftHeld: false,
    volumeTouchHeld: false,
    knobPage: 'A',
    editScope: 'P', /* P=pad slot, G=focused section+bank */
    fxScreenScope: 'bank', /* bank|global */
    selectedBankFxEffect: 0,
    selectedGlobalFxEffect: 0,
    globalFxEffects: createFxEffectArray('global'),

    selectedSlice: 0,
    focusedSection: 0,

    sections: [
        makeSection(MODE_SINGLE),
        makeSection(MODE_PER_SLOT)
    ],

    globalGain: 1.0,
    globalPitch: 0.0,
    velocitySens: 0,

    recordMaxSeconds: 30,
    recording: 0,
    recordArmed: false,
    recordState: 'idle', /* idle|armed|starting|recording|stopping */
    recordStateTicks: 0,
    recordLoadOnStop: false,
    recordMonitorOn: false,
    recordBlinkOn: false,
    recordBlinkTicks: 0,
    recTarget: { sec: 0, bank: 0, slot: 0 },
    recTargetLocked: { sec: 0, bank: 0, slot: 0, slice: 0 },
    lastRecordedPath: '',
    recordStartLastPath: '',
    recordPendingPathTicks: 0,
    recordPendingLoadOnStop: false,
    recordPendingTarget: null,
    startTrimSoundingEnabled: true,

    browserPath: SAMPLES_DIR,
    browserEntries: [],
    browserCursor: 0,
    browserScroll: 0,
    browserMode: 'samples', /* samples|sessions */
    sessionBrowserIntent: 'load', /* load|save */
    browserAssignMode: 'auto', /* auto|slot|source */
    browserLastSamplePath: '',
    browserFocusByPath: {},
    previewPendingPath: '',
    previewPendingAt: 0,
    previewCurrentPath: '',
    sessionName: DEFAULT_SESSION_NAME,
    sessionCharIndex: 0,

    copySource: null,
    copyHeld: false,
    copyPressTick: -1,
    copyConsumed: false,
    deleteHeld: false,
    stepCopySource: null,
    stepFxHold: null, /* { note, startedAtMs, momentaryActive, prevView, prevFxScope } */
    activePadPress: {},
    binaryKnobState: {},
    muteHeld: false,
    lastPadTriggerTick: -9999,
    midiEchoSuppression: true,
    recentOutboundMidi: {},

    transportTicks: 0,
    padPressFlash: {},
    padPlaybackState: {},
    midiLoopers: Array.from({ length: LOOPER_COUNT }, () => createLooperState()),
    activeLooper: 0,
    playLastPressTick: -9999,
    loopPadMode: false,
    loopPadPage: 0,
    loopPadSection: 1, /* 1=right grid, 0=left grid */
    loopPadFullGrid: false,

    statusText: '',
    statusTicks: 0,
    ledsDirty: true,
    ledQueue: [],
    ledResyncTicks: 0,
    ledResyncPasses: 0,

    autosavePending: false,
    autosaveTicks: 0,
    focusedParamRefreshTicks: 0,
    trimReplayTicks: 0,
    trimReplayPendingAll: false,
    trimPreviewSerial: 0,

    undoHistory: [],
    redoHistory: [],
    historyTxnDepth: 0,
    historyTxnDirty: false,
    historyApplying: false,
};

const editCursorCache = { sec: -1, bank: -1, slot: -1 };
const playbackCompatCache = { sec: -1, bank: -1, slot: -1 };
const midiHeldByChannelNote = {};
const activeVoicesByAddr = {};
const pendingNoteOffsByAddr = {};

function normalizeSide(side) {
    if (side === 1 || side === 'right' || side === 'R' || side === 'r') return 1;
    return 0;
}

function getNoteForPad(padIndex) {
    const idx = clampInt(padIndex, 0, GRID_SIZE - 1, 0);
    return MIDI_FIXED_NOTES[idx];
}

function getPadFromNote(note) {
    const n = clampInt(note, 0, 127, -1);
    const idx = MIDI_FIXED_NOTES.indexOf(n);
    return idx >= 0 ? idx : -1;
}

function getChannel(side, bank) {
    const sSide = normalizeSide(side);
    const sBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    return sSide === 0 ? (sBank + 1) : (sBank + 9);
}

function getBankFromChannel(channel) {
    const ch = clampInt(channel, 1, 16, -1);
    if (ch < 1 || ch > 16) return null;
    if (ch <= 8) return { side: 0, bank: ch - 1 };
    return { side: 1, bank: ch - 9 };
}

function midiChannelNibbleFrom1Based(channel1Based) {
    return clampInt(channel1Based, 1, 16, 1) - 1;
}

function midiEchoKey(status, d1, d2) {
    const st = status & 0xFF;
    const hi = st & 0xF0;
    if (hi === 0x90 || hi === 0x80) {
        const note = d1 & 0x7F;
        const normalized = (hi === 0x90 && (d2 & 0x7F) > 0) ? 'note_on' : 'note_off';
        return String(st & 0x0F) + ':' + normalized + ':' + String(note);
    }
    return String(st) + ':' + String(d1 & 0x7F) + ':' + String(d2 & 0x7F);
}

function rememberOutboundMidi(status, d1, d2) {
    if (!s.midiEchoSuppression) return;
    s.recentOutboundMidi[midiEchoKey(status, d1, d2)] = Date.now();
}

function shouldSuppressEchoedMidi(status, d1, d2) {
    if (!s.midiEchoSuppression) return false;
    const now = Date.now();
    const key = midiEchoKey(status, d1, d2);
    const ts = clampInt(s.recentOutboundMidi[key], 0, 0x7fffffff, 0);
    if (!ts) return false;
    if ((now - ts) <= MIDI_ECHO_SUPPRESS_WINDOW_MS) return true;
    delete s.recentOutboundMidi[key];
    return false;
}

function sendExternalMidi(data) {
    const bytes = Array.isArray(data) ? data : [];
    if (bytes.length < 3) return false;
    const status = clampInt(bytes[0], 0, 255, 0);
    const d1 = clampInt(bytes[1], 0, 127, 0);
    const d2 = clampInt(bytes[2], 0, 127, 0);
    rememberOutboundMidi(status, d1, d2);
    const framed = [(2 << 4) | ((status & 0xF0) >> 4), status, d1, d2];
    try {
        if (typeof move_midi_external_send === 'function') {
            move_midi_external_send(framed);
            return true;
        }
    } catch (e) {}
    try {
        if (typeof host_midi_send_external === 'function') {
            host_midi_send_external(bytes);
            return true;
        }
    } catch (e) {}
    try {
        if (typeof move_midi_send_external === 'function') {
            move_midi_send_external(bytes);
            return true;
        }
    } catch (e) {}
    return false;
}

function unpackMidiMessage(data) {
    if (!data || typeof data.length !== 'number') return null;
    if (data.length >= 4) {
        const status = clampInt(data[1], 0, 255, 0);
        if ((status & 0x80) !== 0) {
            return [status, clampInt(data[2], 0, 127, 0), clampInt(data[3], 0, 127, 0)];
        }
    }
    if (data.length >= 3) {
        return [
            clampInt(data[0], 0, 255, 0),
            clampInt(data[1], 0, 127, 0),
            clampInt(data[2], 0, 127, 0)
        ];
    }
    return null;
}

function activateStandaloneMidiPort() {
    const target = 'standalone';
    try {
        if (typeof host_set_midi_port === 'function') host_set_midi_port(target);
    } catch (e) {}
    try {
        if (typeof host_set_midi_input_port === 'function') host_set_midi_input_port(target);
    } catch (e) {}
    try {
        if (typeof host_set_midi_output_port === 'function') host_set_midi_output_port(target);
    } catch (e) {}
    try {
        if (typeof move_midi_select_port === 'function') move_midi_select_port(target);
    } catch (e) {}
    try {
        sp('midi_port', target);
        sp('midi_in_port', target);
        sp('midi_out_port', target);
    } catch (e) {}
}

function gp(key, fallback) {
    try {
        const v = host_module_get_param(key);
        return v != null ? v : fallback;
    } catch (e) {
        return fallback;
    }
}

function sp(key, val) {
    try {
        host_module_set_param(key, String(val));
    } catch (e) {}
}

function spb(key, val, timeoutMs) {
    const value = String(val);
    try {
        if (typeof host_module_set_param_blocking === 'function') {
            host_module_set_param_blocking(key, value, timeoutMs || 250);
        } else {
            host_module_set_param(key, value);
        }
    } catch (e) {}
}

function spe(key, val) {
    spb(key, val, 60);
}

function fsApi() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.fs || null;
}

function stdApi() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.std || null;
}

function pathCandidates(path) {
    const out = [];
    const seen = new Set();
    function add(v) {
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
    }
    add(path);
    if (String(path).startsWith('/data/UserData/')) add(String(path).slice('/data/UserData/'.length));
    const parts = String(path).split('/');
    add(parts[parts.length - 1]);
    return out;
}

function sanitizeSessionName(name) {
    let out = String(name || '').toUpperCase();
    out = out.replace(/\.JSON$/i, '');
    out = out.replace(/[^A-Z0-9_-]/g, '_');
    out = out.replace(/^_+/, '').replace(/_+$/, '');
    if (!out) out = DEFAULT_SESSION_NAME;
    if (out.length > SESSION_NAME_MAX) out = out.slice(0, SESSION_NAME_MAX);
    return out;
}

function sessionPathFromName(name) {
    return SESSIONS_DIR + '/' + sanitizeSessionName(name) + '.json';
}

function sessionNameFromPath(path) {
    const b = baseName(path);
    return sanitizeSessionName(b.replace(/\.json$/i, ''));
}

function makeInitSessionPayload() {
    const left = makeSection(MODE_SINGLE);
    const right = makeSection(MODE_PER_SLOT);
    return {
        version: 5,
        sessionName: INIT_SESSION_NAME,
        selectedSlice: 0,
        focusedSection: 0,
        knobPage: 'A',
        editScope: 'P',
        browserAssignMode: 'auto',
        globalGain: 1.0,
        globalPitch: 0.0,
        velocitySens: 0,
        recordMaxSeconds: 30,
        activeLooper: 0,
        loopPadMode: false,
        midiLoopers: Array.from({ length: LOOPER_COUNT }, () => createLooperState()),
        loopPadPage: 0,
        loopPadSection: 1,
        loopPadFullGrid: false,
        sections: [
            {
                mode: left.mode,
                currentBank: left.currentBank,
                banks: left.banks.map((bank) => cloneBank(bank))
            },
            {
                mode: right.mode,
                currentBank: right.currentBank,
                banks: right.banks.map((bank) => cloneBank(bank))
            }
        ]
    };
}

function ensureInitSessionFile(forceOverwrite = false) {
    if (!ensureDirRecursive(SESSIONS_DIR)) return false;
    const path = sessionPathFromName(INIT_SESSION_NAME);

    if (!forceOverwrite) {
        const existing = readTextFile(path);
        if (existing) {
            try {
                const parsed = JSON.parse(existing);
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sections)) return true;
            } catch (e) {}
        }
    }

    return writeTextFile(path, JSON.stringify(makeInitSessionPayload(), null, 2) + '\n');
}

function readTextFile(path) {
    const candidates = pathCandidates(path);

    if (typeof host_read_file === 'function') {
        for (const p of candidates) {
            try {
                const raw = host_read_file(p);
                if (raw !== null && raw !== undefined) return String(raw);
            } catch (e) {}
        }
    }

    const fs = fsApi();
    if (fs && typeof fs.readFileSync === 'function') {
        for (const p of candidates) {
            try {
                return String(fs.readFileSync(p, 'utf8'));
            } catch (e) {}
        }
    }

    const std = stdApi();
    if (std && typeof std.loadFile === 'function') {
        for (const p of candidates) {
            try {
                const raw = std.loadFile(p);
                if (raw !== null && raw !== undefined) return String(raw);
            } catch (e) {}
        }
    }

    return null;
}

function writeTextFile(path, text) {
    const candidates = pathCandidates(path);

    if (typeof host_write_file === 'function') {
        for (const p of candidates) {
            try {
                host_write_file(p, text);
                return true;
            } catch (e) {}
        }
    }

    const fs = fsApi();
    if (fs && typeof fs.writeFileSync === 'function') {
        try {
            fs.writeFileSync(path, text, 'utf8');
            return true;
        } catch (e) {
            for (const p of candidates) {
                try {
                    fs.writeFileSync(p, text, 'utf8');
                    return true;
                } catch (e2) {}
            }
        }
    }

    return false;
}

function ensureDirRecursive(path) {
    try {
        const st = os.stat(path);
        if (st && !st[1] && (st[0].mode & 0o170000) === 0o040000) return true;
    } catch (e) {}

    const fs = fsApi();
    if (fs && typeof fs.mkdirSync === 'function') {
        try {
            fs.mkdirSync(path, { recursive: true });
            return true;
        } catch (e) {}
    }

    const parts = String(path || '').split('/').filter((p) => p.length > 0);
    if (!parts.length) return false;

    let acc = '';
    if (String(path).startsWith('/')) acc = '/';
    for (let i = 0; i < parts.length; i++) {
        acc = acc ? (acc.endsWith('/') ? acc + parts[i] : acc + '/' + parts[i]) : parts[i];
        try {
            os.mkdir(acc, 0o755);
        } catch (e) {
            try {
                const st = os.stat(acc);
                if (!st || st[1] || (st[0].mode & 0o170000) !== 0o040000) return false;
            } catch (e2) {
                return false;
            }
        }
    }
    return true;
}

function renameFilePath(fromPath, toPath) {
    const fs = fsApi();
    if (fs && typeof fs.renameSync === 'function') {
        try {
            fs.renameSync(fromPath, toPath);
            return true;
        } catch (e) {}
    }
    if (typeof os.rename === 'function') {
        try {
            const ret = os.rename(fromPath, toPath);
            if (Array.isArray(ret)) return !ret[1];
            return true;
        } catch (e) {}
    }
    return false;
}

function deleteFilePath(path) {
    const fs = fsApi();
    if (fs && typeof fs.unlinkSync === 'function') {
        try {
            fs.unlinkSync(path);
            return true;
        } catch (e) {}
    }
    if (typeof os.remove === 'function') {
        try {
            const ret = os.remove(path);
            if (Array.isArray(ret)) return !ret[1];
            return true;
        } catch (e) {}
    }
    if (typeof os.unlink === 'function') {
        try {
            const ret = os.unlink(path);
            if (Array.isArray(ret)) return !ret[1];
            return true;
        } catch (e) {}
    }
    return false;
}

function dirName(path) {
    const raw = String(path || '');
    if (!raw) return '';
    const idx = raw.lastIndexOf('/');
    if (idx <= 0) return idx === 0 ? '/' : '';
    return raw.slice(0, idx);
}

function pathExists(path) {
    if (!path) return false;
    try {
        const st = os.stat(path);
        if (Array.isArray(st)) return !!st[0] && !st[1];
        return !!st;
    } catch (e) {}
    const fs = fsApi();
    if (fs && typeof fs.existsSync === 'function') {
        try {
            return !!fs.existsSync(path);
        } catch (e2) {}
    }
    return false;
}

function isoLocalDateString(tsMs = Date.now()) {
    const d = new Date(tsMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function recordingsDayDir(tsMs = Date.now()) {
    return RECORDED_SAMPLES_ROOT + '/' + isoLocalDateString(tsMs);
}

function uniquePathInDir(dir, fileName) {
    const cleanName = String(fileName || '').trim() || 'recording.wav';
    const dot = cleanName.lastIndexOf('.');
    const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
    const ext = dot > 0 ? cleanName.slice(dot) : '';
    let candidate = dir + '/' + cleanName;
    if (!pathExists(candidate)) return candidate;
    for (let i = 1; i < 1000; i++) {
        candidate = dir + '/' + stem + '_' + String(i) + ext;
        if (!pathExists(candidate)) return candidate;
    }
    return dir + '/' + stem + '_' + String(Date.now()) + ext;
}

function ensureRecordedFileInDailyFolder(path) {
    const src = String(path || '');
    if (!src) return src;
    const dayDir = recordingsDayDir(Date.now());
    if (dirName(src) === dayDir) return src;
    if (!ensureDirRecursive(dayDir)) return src;
    const dst = uniquePathInDir(dayDir, baseName(src));
    if (renameFilePath(src, dst)) return dst;
    return src;
}

function autosavePath() {
    return AUTOSAVE_SESSION_FILE;
}

function scheduleAutosave() {
    s.autosavePending = true;
    s.autosaveTicks = AUTOSAVE_DELAY_TICKS;
}

function currentSessionSnapshot() {
    try {
        return JSON.stringify(serializeSession());
    } catch (e) {
        return '';
    }
}

function commitHistorySnapshot(clearRedo) {
    if (s.historyApplying) return false;
    const snap = currentSessionSnapshot();
    if (!snap) return false;

    const last = s.undoHistory.length ? s.undoHistory[s.undoHistory.length - 1] : '';
    if (last === snap) {
        if (clearRedo) s.redoHistory = [];
        return false;
    }

    s.undoHistory.push(snap);
    if (s.undoHistory.length > HISTORY_MAX) s.undoHistory.shift();
    if (clearRedo) s.redoHistory = [];
    return true;
}

function beginHistoryTransaction() {
    if (s.historyApplying) return;
    s.historyTxnDepth++;
}

function endHistoryTransaction() {
    if (s.historyApplying) return;
    if (s.historyTxnDepth > 0) s.historyTxnDepth--;
    if (s.historyTxnDepth === 0 && s.historyTxnDirty) {
        s.historyTxnDirty = false;
        commitHistorySnapshot(true);
    }
}

function noteHistoryChanged() {
    if (s.historyApplying) return;
    if (s.historyTxnDepth > 0) {
        s.historyTxnDirty = true;
        return;
    }
    commitHistorySnapshot(true);
}

function resetHistory() {
    s.undoHistory = [];
    s.redoHistory = [];
    s.historyTxnDepth = 0;
    s.historyTxnDirty = false;
    commitHistorySnapshot(false);
}

function applyHistorySnapshot(snapshot, actionLabel) {
    if (!snapshot) return false;

    let parsed;
    try {
        parsed = JSON.parse(snapshot);
    } catch (e) {
        return false;
    }

    let ok = false;
    s.historyApplying = true;
    try {
        ok = applyParsedSession(parsed, true, actionLabel || '');
    } finally {
        s.historyApplying = false;
    }
    if (ok) scheduleAutosave();
    return ok;
}

function undoSessionState() {
    if (s.undoHistory.length <= 1) {
        showStatus('Nothing to undo', 90);
        return;
    }

    const current = s.undoHistory.pop();
    if (current) s.redoHistory.push(current);

    const prev = s.undoHistory[s.undoHistory.length - 1];
    if (!applyHistorySnapshot(prev, 'undo')) {
        const rollback = s.redoHistory.pop();
        if (rollback) s.undoHistory.push(rollback);
        showStatus('Undo failed', 120);
        return;
    }

    showStatus('Undo', 90);
    s.dirty = true;
}

function redoSessionState() {
    if (!s.redoHistory.length) {
        showStatus('Nothing to redo', 90);
        return;
    }

    const next = s.redoHistory.pop();
    if (!applyHistorySnapshot(next, 'redo')) {
        showStatus('Redo failed', 120);
        return;
    }

    const last = s.undoHistory.length ? s.undoHistory[s.undoHistory.length - 1] : '';
    if (last !== next) {
        s.undoHistory.push(next);
        if (s.undoHistory.length > HISTORY_MAX) s.undoHistory.shift();
    }

    showStatus('Redo', 90);
    s.dirty = true;
}

function markSessionChanged() {
    scheduleAutosave();
    noteHistoryChanged();
}

function scheduleFocusedSlotRefresh(ticks = SLOT_PARAM_REFRESH_TICKS_AFTER_LOAD) {
    s.focusedParamRefreshTicks = Math.max(
        clampInt(ticks, 0, 1024, SLOT_PARAM_REFRESH_TICKS_AFTER_LOAD),
        clampInt(s.focusedParamRefreshTicks, 0, 1024, 0)
    );
}

function scheduleTrimReplayAll(ticks = SLOT_TRIM_REPLAY_TICKS_AFTER_LOAD) {
    s.trimReplayPendingAll = true;
    s.trimReplayTicks = Math.max(
        clampInt(ticks, 0, 2048, SLOT_TRIM_REPLAY_TICKS_AFTER_LOAD),
        clampInt(s.trimReplayTicks, 0, 2048, 0)
    );
}

function replayAllSlotParamsToDsp() {
    for (let sec = 0; sec < GRID_COUNT; sec++) {
        for (let bank = 0; bank < BANK_COUNT; bank++) {
            for (let slot = 0; slot < GRID_SIZE; slot++) {
                const sl = slotAt(sec, bank, slot);
                sp('slot_attack_at', fmtAt(sec, bank, slot, sl.attack.toFixed(2)));
                sp('slot_decay_at', fmtAt(sec, bank, slot, sl.decay.toFixed(2)));
                sp('slot_start_trim_at', fmtAt(sec, bank, slot, sl.startTrim.toFixed(2)));
                sendSlotEndTrimToDsp(sec, bank, slot, sl.endTrim.toFixed(2));
                sp('slot_gain_at', fmtAt(sec, bank, slot, sl.gain.toFixed(3)));
                sp('slot_pan_at', fmtAt(sec, bank, slot, sl.pan.toFixed(3)));
                sp('slot_pitch_at', fmtAt(sec, bank, slot, sl.pitch.toFixed(2)));
                sp('slot_mode_at', fmtAt(sec, bank, slot, sl.modeGate));
                sp('slot_loop_at', fmtAt(sec, bank, slot, sl.loop));
            }
        }
    }
}

function bankSliceStateKey(prefix, sec, bank) {
    return prefix + '_' + clampInt(sec, 0, GRID_COUNT - 1, 0) + '_' + clampInt(bank, 0, BANK_COUNT - 1, 0);
}

function bankSlicePointKey(sec, bank, idx) {
    return 'section_slice_start_' +
        clampInt(sec, 0, GRID_COUNT - 1, 0) + '_' +
        clampInt(bank, 0, BANK_COUNT - 1, 0) + '_' +
        clampInt(idx, 0, 128, 0);
}

function parseSliceStartsString(raw, chopCount) {
    const expected = normalizeChopCount(chopCount) + 1;
    if (!raw) return [];

    const parts = String(raw).split(',');
    const out = [];
    for (let i = 0; i < parts.length && out.length < expected; i++) {
        const trimmed = parts[i].trim();
        if (!trimmed.length) continue;
        const n = parseInt(trimmed, 10);
        if (!Number.isFinite(n)) continue;
        out.push(clampInt(n, 0, 0x7fffffff, 0));
    }

    if (out.length !== expected) return [];
    return out;
}

function serializeSliceStarts(starts, chopCount) {
    const expected = normalizeChopCount(chopCount) + 1;
    if (!Array.isArray(starts) || starts.length !== expected) return '';
    return starts.map((v) => clampInt(v, 0, 0x7fffffff, 0)).join(',');
}

function syncBankSliceState(sec, bank) {
    const b = s.sections[sec].banks[bank];
    b.transientSensitivity = normalizeTransientSensitivity(
        gp(bankSliceStateKey('section_transient_sensitivity', sec, bank), b.transientSensitivity)
    );
    const count = normalizeChopCount(b.chopCount);
    const starts = [];
    for (let i = 0; i <= count; i++) {
        const raw = gp(bankSlicePointKey(sec, bank, i), null);
        if (raw === null || raw === undefined || raw === '') {
            starts.length = 0;
            break;
        }
        const n = parseInt(String(raw), 10);
        if (!Number.isFinite(n)) {
            starts.length = 0;
            break;
        }
        starts.push(clampInt(n, 0, 0x7fffffff, 0));
    }
    if (starts.length === count + 1) {
        b.sliceStarts = starts;
        sp('section_slice_starts', sec + ':' + bank + ':' + starts.join(','));
    }
}

function showStatus(msg, ticks = STATUS_TICKS) {
    s.statusText = String(msg || '');
    s.statusTicks = ticks;
    s.dirty = true;
}

function markLedsDirty() {
    s.ledsDirty = true;
    s.dirty = true;
}

function clearPadAndStepLeds() {
    for (let note = PAD_NOTE_MIN; note <= PAD_NOTE_MAX; note++) {
        setLED(note, Black);
    }
    if (USE_STEP_BANKS) {
        for (let note = STEP_NOTE_MIN; note <= STEP_NOTE_MAX; note++) {
            setLED(note, Black);
        }
    }
}

function normalizeColor(v, fallback) {
    if (v === null || v === undefined) return fallback;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, 0, 127);
}

function cycleInPalette(current, palette, delta, fallback) {
    const cur = parseInt(current, 10);
    let idx = palette.indexOf(cur);
    if (idx < 0) {
        const fb = parseInt(fallback, 10);
        idx = palette.indexOf(Number.isFinite(fb) ? fb : palette[0]);
    }
    if (idx < 0) idx = 0;
    const next = clamp(idx + (delta > 0 ? 1 : -1), 0, palette.length - 1);
    return palette[next];
}

function focusedBankIndex(sec = s.focusedSection) {
    return s.sections[sec].currentBank;
}

function focusedSlotIndex() {
    return slotFromSlice(s.selectedSlice);
}

function focusedBank(sec = s.focusedSection) {
    return s.sections[sec].banks[focusedBankIndex(sec)];
}

function maxPagesForBank(bank) {
    void bank;
    return 1;
}

function focusedSlot() {
    return focusedBank().slots[focusedSlotIndex()];
}

function setSelectedSlice(sliceIdx, blocking = false, skipPlaybackCompat = false) {
    const rawSlice = clampInt(sliceIdx, 0, TOTAL_PADS - 1, 0);
    const slice = LEFT_GRID_ONLY ? slotFromSlice(rawSlice) : rawSlice;
    s.selectedSlice = slice;
    s.focusedSection = sectionFromSlice(slice);
    const dspSlice = dspSliceFromCustomSlice(slice);

    const send = (blocking || !REALTIME_NONBLOCKING) ? spb : sp;
    send('selected_slice', String(dspSlice), 100);
    send('selected_slot', String(slotFromSlice(slice)), 100);
    send('keyboard_section', String(s.focusedSection), 100);

    ensureEditCursor(!!blocking);
    if (!skipPlaybackCompat) syncFocusedSlotPlaybackCompat();
    s.dirty = true;
}

function ensureEditCursor(blocking = false) {
    const useBlocking = (blocking || !REALTIME_NONBLOCKING);
    const send = useBlocking ? spb : sp;
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();

    if (editCursorCache.sec !== sec) {
        send('edit_section', String(sec), 100);
        if (useBlocking) editCursorCache.sec = sec;
    }
    if (editCursorCache.bank !== bank) {
        send('edit_bank', String(bank), 100);
        if (useBlocking) editCursorCache.bank = bank;
    }
    if (editCursorCache.slot !== slot) {
        send('edit_slot', String(slot), 100);
        if (useBlocking) editCursorCache.slot = slot;
    }
}

function invalidatePlaybackCompat() {
    playbackCompatCache.sec = -1;
    playbackCompatCache.bank = -1;
    playbackCompatCache.slot = -1;
}

function syncFocusedSlotPlaybackCompat(force = false) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    if (!force &&
        playbackCompatCache.sec === sec &&
        playbackCompatCache.bank === bank &&
        playbackCompatCache.slot === slot) {
        return;
    }

    const sl = slotAt(sec, bank, slot);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_attack', sl.attack.toFixed(2), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_decay', sl.decay.toFixed(2), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_start_trim', sl.startTrim.toFixed(2), 120);
    sendSlotEndTrimToDsp(sec, bank, slot, sl.endTrim.toFixed(2), 120, false, true);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_gain', sl.gain.toFixed(3), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_pan', sl.pan.toFixed(3), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_pitch', sl.pitch.toFixed(2), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_mode', sl.modeGate, 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_loop', sl.loop, 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_reverse', sl.reverse ? 1 : 0, 120);

    playbackCompatCache.sec = sec;
    playbackCompatCache.bank = bank;
    playbackCompatCache.slot = slot;
}

function isDir(path) {
    try {
        const [st, err] = os.stat(path);
        return !err && (st.mode & 0o170000) === 0o040000;
    } catch (e) {
        return false;
    }
}

function previewNowMs() {
    if (typeof Date !== 'undefined' && typeof Date.now === 'function') return Date.now();
    return 0;
}

function looperNowMs() {
    return previewNowMs();
}

function currentLooper() {
    const idx = clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0);
    return s.midiLoopers[idx];
}

function looperByIndex(index) {
    return s.midiLoopers[clampInt(index, 0, s.midiLoopers.length - 1, 0)];
}

function looperStateColor(state) {
    if (state === 'recording') return LOOP_PAD_COLOR_RECORD;
    if (state === 'playing') return LOOP_PAD_COLOR_PLAY;
    if (state === 'overdub') return LOOP_PAD_COLOR_OVERDUB;
    if (state === 'stopped') return LOOP_PAD_COLOR_STOPPED;
    return LOOP_PAD_COLOR_OFF;
}

function loopPadIndexFromPadNote(note) {
    if (!s.loopPadMode) return -1;
    const slice = sliceFromPadNote(note);
    if (slice < 0) return -1;
    const sec = sectionFromSlice(slice);
    const activeSection = s.loopPadFullGrid ? clampInt(s.loopPadSection, 0, GRID_COUNT - 1, 1) : 1;
    if (sec !== activeSection) return -1;
    const slot = slotFromSlice(slice);
    if (s.loopPadFullGrid) {
        if (slot < 0 || slot >= s.midiLoopers.length) return -1;
        return slot;
    }
    const maxPage = Math.max(0, Math.floor((s.midiLoopers.length - 1) / LOOPER_PAGE_SIZE));
    const pageStart = clampInt(s.loopPadPage, 0, maxPage, 0) * LOOPER_PAGE_SIZE;
    if (slot < TOP_ROW_SLOT_START || slot >= (TOP_ROW_SLOT_START + LOOPER_PAGE_SIZE)) return -1;
    const idx = pageStart + (slot - TOP_ROW_SLOT_START);
    if (idx < 0 || idx >= s.midiLoopers.length) return -1;
    return idx;
}

function previewCanPlay() {
    return typeof host_preview_play === 'function';
}

function previewStop() {
    s.previewPendingPath = '';
    s.previewPendingAt = 0;
    s.previewCurrentPath = '';
    if (typeof host_preview_stop === 'function') {
        try {
            host_preview_stop();
        } catch (e) {}
    }
}

function previewQueue(path) {
    if (!previewCanPlay() || !path) return;
    const p = String(path);
    if (p === s.previewCurrentPath) return;
    s.previewPendingPath = p;
    s.previewPendingAt = previewNowMs();
}

function previewQueueForCursor() {
    if (s.view !== 'browser' || s.browserMode !== 'samples') return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir || !/\.wav$/i.test(String(e.path || e.name || ''))) {
        previewStop();
        return;
    }
    previewQueue(e.path);
}

function previewTick() {
    if (!s.previewPendingPath || !s.previewPendingAt || !previewCanPlay()) return;
    const now = previewNowMs();
    if (now <= 0 || (now - s.previewPendingAt) < PREVIEW_DEBOUNCE_MS) return;

    const path = s.previewPendingPath;
    s.previewPendingPath = '';
    s.previewPendingAt = 0;

    try {
        host_preview_play(path);
        s.previewCurrentPath = path;
    } catch (e) {}
}

function listSampleEntries(path) {
    const out = [];
    try {
        const [names, err] = os.readdir(path);
        if (!err && names) {
            const dirs = [];
            const files = [];

            if (path !== SAMPLES_DIR) {
                const parts = path.split('/');
                parts.pop();
                dirs.push({ name: '..', path: parts.join('/') || '/', dir: true, type: 'dir' });
            }

            for (const n of names) {
                if (n === '.' || n === '..') continue;
                const full = path + '/' + n;
                if (isDir(full)) dirs.push({ name: n, path: full, dir: true, type: 'dir' });
                else if (/\.wav$/i.test(n)) files.push({ name: n, path: full, dir: false, type: 'wav' });
            }

            dirs.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));
            return dirs.concat(files);
        }
    } catch (e) {}
    return out;
}

function listSessionEntries() {
    const out = [];
    if (!ensureDirRecursive(SESSIONS_DIR)) return out;
    ensureInitSessionFile(false);
    try {
        const [names, err] = os.readdir(SESSIONS_DIR);
        if (!err && names) {
            for (const n of names) {
                if (!/\.json$/i.test(String(n))) continue;
                const full = SESSIONS_DIR + '/' + n;
                out.push({
                    name: sessionNameFromPath(n),
                    path: full,
                    dir: false,
                    type: 'session'
                });
            }
        }
    } catch (e) {}
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function sessionNameExistsInEntries(name, entries) {
    const target = sanitizeSessionName(name);
    const list = Array.isArray(entries) ? entries : listSessionEntries();
    return list.some((e) => !e.dir && sanitizeSessionName(e.name) === target);
}

function selectSessionEntryByName(name) {
    if (s.browserMode !== 'sessions' || !s.browserEntries.length) return false;
    const target = sanitizeSessionName(name);
    const idx = s.browserEntries.findIndex((e) => !e.dir && sanitizeSessionName(e.name) === target);
    if (idx < 0) return false;
    s.browserCursor = idx;
    if (s.browserCursor < s.browserScroll) s.browserScroll = s.browserCursor;
    else if (s.browserCursor >= s.browserScroll + 4) s.browserScroll = s.browserCursor - 3;
    return true;
}

function updateBrowserScrollForCursor() {
    if (s.browserCursor < s.browserScroll) s.browserScroll = s.browserCursor;
    else if (s.browserCursor >= s.browserScroll + 4) s.browserScroll = s.browserCursor - 3;
    if (s.browserScroll < 0) s.browserScroll = 0;
}

function rememberSampleBrowserFocus() {
    if (s.browserMode !== 'samples' || !s.browserPath) return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || !e.path) return;
    s.browserFocusByPath[s.browserPath] = e.path;
}

function selectBrowserEntryByPath(path) {
    if (!path || !s.browserEntries.length) return false;
    const target = String(path);
    const idx = s.browserEntries.findIndex((e) => e && e.path === target);
    if (idx < 0) return false;
    s.browserCursor = idx;
    updateBrowserScrollForCursor();
    return true;
}

function nextAutoSessionName() {
    const entries = listSessionEntries();
    const used = new Set(entries.map((e) => sanitizeSessionName(e.name)));
    for (let i = 1; i <= 99999; i++) {
        const candidate = sanitizeSessionName('SESSION' + String(i).padStart(2, '0'));
        if (!used.has(candidate)) return candidate;
    }
    const now = (typeof Date !== 'undefined' && typeof Date.now === 'function') ? Date.now() : 0;
    return sanitizeSessionName('SESSION' + String(Math.floor(now % 100000)).padStart(5, '0'));
}

function ensureSessionNameForSave(preferAuto) {
    s.sessionName = sanitizeSessionName(s.sessionName);
    const exists = sessionNameExistsInEntries(s.sessionName);
    if (preferAuto || exists) s.sessionName = nextAutoSessionName();
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
}

function openSessionBrowser(intent, preferAutoName) {
    s.view = 'browser';
    s.sessionBrowserIntent = intent === 'save' ? 'save' : 'load';
    browserOpen(SESSIONS_DIR, 'sessions');
    if (s.sessionBrowserIntent === 'save') {
        ensureSessionNameForSave(!!preferAutoName);
        selectSessionEntryByName(s.sessionName);
    } else {
        selectSessionEntryByName(s.sessionName);
    }
    showStatus(s.sessionBrowserIntent === 'save' ? 'Session save menu' : 'Session load menu', 80);
    s.dirty = true;
}

function browserOpen(path, mode, preferredPath = '') {
    rememberSampleBrowserFocus();

    const prevMode = s.browserMode;
    const prevPath = s.browserPath;
    const prevCursor = s.browserCursor;
    const prevScroll = s.browserScroll;
    const prevEntry = s.browserEntries[prevCursor];

    s.browserMode = (mode === 'sessions') ? 'sessions' : 'samples';
    s.browserPath = (s.browserMode === 'sessions') ? SESSIONS_DIR : (path || SAMPLES_DIR);
    s.browserEntries = (s.browserMode === 'sessions') ? listSessionEntries() : listSampleEntries(s.browserPath);

    if (s.browserMode === 'sessions' && !s.sessionBrowserIntent) s.sessionBrowserIntent = 'load';

    s.browserCursor = 0;
    s.browserScroll = 0;
    if (s.browserEntries.length) {
        let focusPath = String(preferredPath || '');
        if (!focusPath && prevMode === s.browserMode && prevPath === s.browserPath && prevEntry && prevEntry.path) {
            focusPath = prevEntry.path;
        }
        if (!focusPath && s.browserMode === 'samples') {
            focusPath = s.browserFocusByPath[s.browserPath] || '';
        }
        if (!focusPath && s.browserMode === 'samples' && dirName(s.browserLastSamplePath) === s.browserPath) {
            focusPath = s.browserLastSamplePath;
        }
        if (!selectBrowserEntryByPath(focusPath) && prevMode === s.browserMode && prevPath === s.browserPath) {
            s.browserCursor = clamp(prevCursor, 0, s.browserEntries.length - 1);
            s.browserScroll = clamp(prevScroll, 0, Math.max(0, s.browserEntries.length - 1));
            updateBrowserScrollForCursor();
        }
    }

    if (s.browserMode === 'samples') previewQueueForCursor();
    else previewStop();

    s.dirty = true;
}

function refreshBrowserList() {
    const curName = s.browserEntries[s.browserCursor] ? s.browserEntries[s.browserCursor].name : '';
    s.browserEntries = (s.browserMode === 'sessions') ? listSessionEntries() : listSampleEntries(s.browserPath);
    if (!s.browserEntries.length) {
        s.browserCursor = 0;
        s.browserScroll = 0;
        return;
    }

    let idx = s.browserEntries.findIndex((e) => e.name === curName);
    if (idx < 0) idx = clamp(s.browserCursor, 0, s.browserEntries.length - 1);
    s.browserCursor = idx;
    updateBrowserScrollForCursor();
    rememberSampleBrowserFocus();
}

function browserScrollBy(delta) {
    const maxIdx = Math.max(0, s.browserEntries.length - 1);
    s.browserCursor = clamp(s.browserCursor + delta, 0, maxIdx);

    updateBrowserScrollForCursor();
    rememberSampleBrowserFocus();

    previewQueueForCursor();
    s.dirty = true;
}

function resolveAssignTarget(sec) {
    if (s.browserAssignMode === 'slot') return 'slot';
    if (s.browserAssignMode === 'source') return 'source';
    return s.sections[sec].mode === MODE_SINGLE ? 'source' : 'slot';
}

function sourcePlayModeForSection(sec) {
    return s.sections[sec].mode === MODE_SINGLE ? 1 : 0;
}

function setSourcePath(sec, bank, path, sendToDsp) {
    const sb = s.sections[sec].banks[bank];
    const nextPath = String(path || '');
    const hadSource = !!sb.sourcePath;
    const loadingNewSource = !!nextPath && (!hadSource || sb.sourcePath !== nextPath);

    if (loadingNewSource) {
        const defaultModeGate = defaultPadModeGateForSectionMode(s.sections[sec].mode);
        for (let i = 0; i < GRID_SIZE; i++) {
            resetSlotSoundParamsToDefault(sb.slots[i]);
            sb.slots[i].modeGate = defaultModeGate;
            if (s.sections[sec].mode === MODE_SINGLE) applySourceModeDefaultsToSlot(sb.slots[i]);
        }
    }

    sb.sourcePath = nextPath;
    sb.chopCount = SOURCE_CHOP_COUNT;
    sb.slicePage = 0;
    if (sendToDsp) {
        spb('section_source_play_mode', sec + ':' + bank + ':' + sourcePlayModeForSection(sec), 300);
        spb('section_chop_count', sec + ':' + bank + ':' + SOURCE_CHOP_COUNT, 300);
        spb('section_slice_page', sec + ':' + bank + ':0', 300);
        spb('section_source_path', sec + ':' + bank + ':' + sb.sourcePath, 1500);
        spb('section_randomize_transients', sec + ':' + bank + ':1', 800);
        syncBankSliceState(sec, bank);
        if (loadingNewSource) {
            for (let i = 0; i < GRID_SIZE; i++) {
                sendSlotStateToDsp(sec, bank, i, true, true);
            }
            scheduleTrimReplayAll();
        }
        if (sec === s.focusedSection && bank === focusedBankIndex(sec)) {
            setSelectedSlice(s.selectedSlice, true, false);
        }
    }
    markSessionChanged();
}

function setSlotPath(sec, bank, slot, path, sendToDsp) {
    const sl = s.sections[sec].banks[bank].slots[slot];
    const nextPath = String(path || '');
    const hadSample = !!sl.path;
    const loadingNewSample = !!nextPath && (!hadSample || sl.path !== nextPath);

    if (loadingNewSample) resetSlotSoundParamsToDefault(sl);
    sl.path = nextPath;

    if (!sendToDsp) {
        markSessionChanged();
        return;
    }

    sendSlotStateToDsp(sec, bank, slot, true, true);
    scheduleTrimReplayAll();
    if (sec === s.focusedSection && bank === focusedBankIndex(sec) && slot === focusedSlotIndex()) {
        invalidatePlaybackCompat();
        syncFocusedSlotPlaybackCompat(true);
        scheduleFocusedSlotRefresh();
    } else {
        setSelectedSlice(s.selectedSlice, true, true);
    }
    markLedsDirty();
    markSessionChanged();
}

function browserSelect() {
    const e = s.browserEntries[s.browserCursor];
    if (!e) return;

    if (s.browserMode === 'sessions') {
        if (loadSessionFromPath(e.path, false)) {
            s.sessionName = sessionNameFromPath(e.path);
            s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
            s.view = 'main';
            showStatus('Loaded ' + s.sessionName, 100);
            s.dirty = true;
        }
        return;
    }

    if (e.dir) {
        const focusPath = e.name === '..' ? s.browserPath : '';
        browserOpen(e.path, 'samples', focusPath);
        return;
    }

    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    const target = resolveAssignTarget(sec);

    if (target === 'source') {
        setSourcePath(sec, bank, e.path, true);
        showStatus('S' + (sec + 1) + 'B' + (bank + 1) + ' source loaded', 110);
    } else {
        setSlotPath(sec, bank, slot, e.path, true);
        showStatus('S' + (sec + 1) + 'B' + (bank + 1) + 'P' + (slot + 1) + ' loaded', 110);
    }

    s.browserLastSamplePath = e.path;
    rememberSampleBrowserFocus();
    previewStop();
    s.view = 'main';
    ensureEditCursor();
    s.dirty = true;
}

function setSectionMode(sec, mode) {
    const m = clampInt(mode, MODE_SINGLE, MODE_PER_SLOT, MODE_PER_SLOT);
    if (s.sections[sec].mode === m) return;

    s.sections[sec].mode = m;
    const bank = focusedBankIndex(sec);
    if (m === MODE_SINGLE) {
        s.sections[sec].banks[bank].chopCount = SOURCE_CHOP_COUNT;
        s.sections[sec].banks[bank].slicePage = 0;
        for (let slot = 0; slot < GRID_SIZE; slot++) {
            const sl = s.sections[sec].banks[bank].slots[slot];
            if (sl.decay <= DEFAULT_DECAY_MS + 1.0) sl.decay = SOURCE_MODE_DEFAULT_DECAY_MS;
        }
    }
    spb('section_mode', sec + ':' + m, 200);
    applyBankStateToDsp(sec, bank, true);

    showStatus('Section ' + (sec + 1) + ' mode ' + (m === MODE_SINGLE ? 'SRC' : 'PAD'), 100);
    markLedsDirty();
    markSessionChanged();
    s.dirty = true;
}

function setSectionBank(sec, bank) {
    const b = clampInt(bank, 0, BANK_COUNT - 1, 0);
    if (s.sections[sec].currentBank === b) {
        showStatus('S' + (sec + 1) + ' bank ' + (b + 1), 50);
        return;
    }

    s.sections[sec].currentBank = b;
    spb('section_bank', sec + ':' + b, 200);
    sendBankToneStateToDsp(sec, b);

    if (sec === s.focusedSection) {
        refreshRealtimeUiState();
    }

    showStatus('S' + (sec + 1) + ' bank ' + (b + 1), 70);
    markLedsDirty();
    markSessionChanged();
    s.dirty = true;
}

function focusSectionForEditing(sec, blocking = false) {
    const targetSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    if (s.focusedSection === targetSec) return false;
    const slot = focusedSlotIndex();
    const nextSlice = dspSliceFromSecSlot(targetSec, slot);
    setSelectedSlice(nextSlice, !!blocking);
    return true;
}

function setSectionChopCount(sec, bank, count) {
    const b = s.sections[sec].banks[bank];
    void count;
    const next = SOURCE_CHOP_COUNT;
    if (b.chopCount === next) return;

    b.chopCount = next;
    b.slicePage = 0;

    spb('section_chop_count', sec + ':' + bank + ':' + next, 300);
    spb('section_slice_page', sec + ':' + bank + ':0', 300);
    syncBankSliceState(sec, bank);
    showStatus('S' + (sec + 1) + 'B' + (bank + 1) + ' chops ' + next, 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustFocusedChopCount(delta) {
    void delta;
    showStatus('Source chops fixed at 16', 90);
}

function setSectionSlicePage(sec, bank, page) {
    const b = s.sections[sec].banks[bank];
    const next = clampInt(page, 0, maxPagesForBank(b) - 1, 0);
    if (b.slicePage === next) return;

    b.slicePage = next;
    spb('section_slice_page', sec + ':' + bank + ':' + next, 300);
    showStatus('S' + (sec + 1) + 'B' + (bank + 1) + ' page ' + (next + 1) + '/' + maxPagesForBank(b), 80);
    markSessionChanged();
    s.dirty = true;
}

function setSectionTransientSensitivity(sec, bank, value) {
    const b = s.sections[sec].banks[bank];
    const next = normalizeTransientSensitivity(value);
    if (b.transientSensitivity === next) return;

    b.transientSensitivity = next;
    spb('section_transient_sensitivity', sec + ':' + bank + ':' + next, 300);
    syncBankSliceState(sec, bank);
    showStatus('S' + (sec + 1) + 'B' + (bank + 1) + ' trans ' + next, 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustFocusedTransientSensitivity(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const b = s.sections[sec].banks[bank];
    setSectionTransientSensitivity(sec, bank, b.transientSensitivity + delta * 5);
}

function adjustFocusedSlicePage(delta) {
    void delta;
    showStatus('Single page 1/1', 70);
}

function randomizeFocusedTransientSlices() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const sb = s.sections[sec].banks[bank];
    if (s.sections[sec].mode !== MODE_SINGLE || !sb.sourcePath) {
        showStatus('Source bank only', 90);
        return;
    }
    sb.chopCount = SOURCE_CHOP_COUNT;
    sb.slicePage = 0;
    spb('section_source_play_mode', sec + ':' + bank + ':' + sourcePlayModeForSection(sec), 300);
    spb('section_chop_count', sec + ':' + bank + ':' + SOURCE_CHOP_COUNT, 300);
    spb('section_slice_page', sec + ':' + bank + ':0', 300);
    spb('section_randomize_transients', sec + ':' + bank + ':1', 300);
    syncBankSliceState(sec, bank);
    showStatus('S' + (sec + 1) + 'B' + (bank + 1) + ' transients randomized', 110);
    markSessionChanged();
    s.dirty = true;
}

function slotAt(sec, bank, slot) {
    return s.sections[sec].banks[bank].slots[slot];
}

function fmtAt(sec, bank, slot, value) {
    return sec + ':' + bank + ':' + slot + ':' + value;
}

function sliceCompatKeyFor(slotKey) {
    if (slotKey === 'slot_attack') return 'slice_attack';
    if (slotKey === 'slot_decay') return 'slice_decay';
    if (slotKey === 'slot_start_trim') return 'slice_start_trim';
    if (slotKey === 'slot_gain') return 'slice_gain';
    if (slotKey === 'slot_pan') return 'slice_pan';
    if (slotKey === 'slot_pitch') return 'slice_pitch';
    if (slotKey === 'slot_mode') return 'slice_mode';
    if (slotKey === 'slot_loop') return 'slice_loop';
    return '';
}

function sendDirectSlotParamCompat(sec, bank, slot, keyDirect, value, timeoutMs, blocking = false) {
    const v = String(value);
    const tm = timeoutMs || 120;
    const useBlocking = (blocking || !REALTIME_NONBLOCKING);
    const send = useBlocking ? spb : sp;
    const dspSlice = dspSliceFromSecSlot(sec, slot);

    if (editCursorCache.sec !== sec) {
        send('edit_section', String(sec), tm);
        if (useBlocking) editCursorCache.sec = sec;
    }
    if (editCursorCache.bank !== bank) {
        send('edit_bank', String(bank), tm);
        if (useBlocking) editCursorCache.bank = bank;
    }
    if (editCursorCache.slot !== slot) {
        send('edit_slot', String(slot), tm);
        if (useBlocking) editCursorCache.slot = slot;
    }

    send(keyDirect, v, tm);
    const sliceKey = sliceCompatKeyFor(keyDirect);
    if (sliceKey) {
        send('selected_slice', String(dspSlice), tm);
        send('selected_slot', String(slot), tm);
        send(sliceKey, v, tm);
    }
}

function sendSlotParamCompat(sec, bank, slot, keyAt, keyDirect, value, timeoutMs, blocking = false) {
    const v = String(value);
    const tm = timeoutMs || 180;
    const focused = sec === s.focusedSection && bank === focusedBankIndex(sec) && slot === focusedSlotIndex();
    const shouldSendDirect = !!blocking || focused;
    const useBlocking = !!blocking || (!REALTIME_NONBLOCKING && focused);
    if (useBlocking) spb(keyAt, fmtAt(sec, bank, slot, v), tm);
    else sp(keyAt, fmtAt(sec, bank, slot, v));

    /* Avoid selected_slice churn and param flooding on bulk/non-focused writes. */
    if (shouldSendDirect) {
        sendDirectSlotParamCompat(sec, bank, slot, keyDirect, v, tm, useBlocking);
    }
}

function resetEditCursorCache() {
    editCursorCache.sec = -1;
    editCursorCache.bank = -1;
    editCursorCache.slot = -1;
}

function setSlotAttack(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, 1.0, 5000.0, 5.0);
    slotAt(sec, bank, slot).attack = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_attack_at', 'slot_attack', v.toFixed(2), 180, !!forceDirect);
    markSessionChanged();
}

function setSlotDecay(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, 1.0, DECAY_MAX_MS, DEFAULT_DECAY_MS);
    slotAt(sec, bank, slot).decay = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_decay_at', 'slot_decay', v.toFixed(2), 180, !!forceDirect);
    markSessionChanged();
}

function setSlotStartTrim(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, 0.0);
    slotAt(sec, bank, slot).startTrim = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_start_trim_at', 'slot_start_trim', v.toFixed(2), 180, !!forceDirect);
    markSessionChanged();
}

function sendSlotEndTrimToDsp(sec, bank, slot, value, timeoutMs = 180, blocking = false, sendDirect = false) {
    const v = (-clampFloat(value, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, 0.0)).toFixed(2);
    const tm = timeoutMs || 180;
    if (blocking || !REALTIME_NONBLOCKING) spb('slot_end_trim_at', fmtAt(sec, bank, slot, v), tm);
    else sp('slot_end_trim_at', fmtAt(sec, bank, slot, v));
    if (sendDirect) sendDirectSlotParamCompat(sec, bank, slot, 'slot_end_trim', v, tm, !!blocking);
}

function setSlotEndTrim(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, 0.0);
    slotAt(sec, bank, slot).endTrim = v;
    /*
     * Keep end trim on the addressed `_at` key and send it with the inverse
     * sign. The core's trim convention uses positive offsets from the start;
     * a negative value trims back from the sample end.
     */
    sendSlotEndTrimToDsp(sec, bank, slot, v.toFixed(2), 180, !!forceDirect, true);
    markSessionChanged();
}

function setSlotGain(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, 0.0, 4.0, 1.0);
    slotAt(sec, bank, slot).gain = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_gain_at', 'slot_gain', v.toFixed(3), 180, !!forceDirect);
    markSessionChanged();
}

function setSlotPan(sec, bank, slot, value, forceDirect = false) {
    const v = clampFloat(value, -1.0, 1.0, 0.0);
    slotAt(sec, bank, slot).pan = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_pan_at', 'slot_pan', v.toFixed(3), 180, !!forceDirect);
    markSessionChanged();
}

function setSlotPitch(sec, bank, slot, value) {
    const v = clampFloat(value, -48.0, 48.0, 0.0);
    slotAt(sec, bank, slot).pitch = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_pitch_at', 'slot_pitch', v.toFixed(2), 180, true);
    markSessionChanged();
}

function setSlotMode(sec, bank, slot, modeGate, forceDirect = false) {
    const v = clampInt(modeGate, 0, 1, 1);
    slotAt(sec, bank, slot).modeGate = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_mode_at', 'slot_mode', v, 180, !!forceDirect);
    markSessionChanged();
}

function setSlotLoop(sec, bank, slot, loopMode, forceDirect = false) {
    const v = clampInt(loopMode, 0, 2, 0);
    const sl = slotAt(sec, bank, slot);
    const prev = clampInt(sl.loop, 0, 2, 0);
    sl.loop = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_loop_at', 'slot_loop', v, 180, !!forceDirect);
    /*
     * Keep trim points in lockstep across normal <-> loop mode transitions.
     * Some DSP paths cache loop-region boundaries independently, so resend the
     * current trim pair whenever loop mode changes.
     */
    sendSlotParamCompat(sec, bank, slot, 'slot_start_trim_at', 'slot_start_trim', sl.startTrim.toFixed(2), 180, true);
    sendSlotEndTrimToDsp(sec, bank, slot, sl.endTrim.toFixed(2), 180, true, true);
    if (prev > 0 && v > 0 && prev !== v) {
        const voice = currentVoiceAt(sec, bank, slot);
        if (voice) {
            const vel = clampInt(voice.velocity, 1, 127, 127);
            refreshActiveLoopVoiceForTrim(sec, bank, slot, vel, !!voice.routeBank, 'loop-mode-switch:' + String(v));
        }
    }
    if (prev > 0 && v === 0) {
        /*
         * Seamlessly return to normal one-shot/gate behavior when looping is disabled.
         * If the pad is currently latched as a loop voice, release it immediately so
         * subsequent presses behave like normal pads again.
         */
        releaseActiveVoice(sec, bank, slot, false, false, Date.now(), true);
        /*
         * Defensive hard-stop: if the DSP loop voice is still latched despite voice-map
         * state changes, emit an explicit note-off on both routed and direct paths.
         */
        clearPendingOff(sec, bank, slot);
        emitPadNoteOffNow(sec, bank, slot, true, false);
        emitPadNoteOffNow(sec, bank, slot, false, false);
        delete activeVoicesByAddr[addrKey(sec, bank, slot)];
        const keys = Object.keys(s.activePadPress);
        for (let i = 0; i < keys.length; i++) {
            const press = s.activePadPress[keys[i]];
            if (!press) continue;
            if (press.sec === sec && press.bank === bank && press.slot === slot) delete s.activePadPress[keys[i]];
        }
        setPadPlaybackState(sec, bank, slot, 'idle');
        markLedsDirty();
    }
    markSessionChanged();
}

function setSlotReverse(sec, bank, slot, reverseOn, forceDirect = false) {
    const v = clampInt(reverseOn, 0, 1, 0);
    slotAt(sec, bank, slot).reverse = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_reverse_at', 'slot_reverse', v, 180, !!forceDirect);
    markSessionChanged();
}

function forEachSlotInBank(sec, bank, fn) {
    for (let i = 0; i < GRID_SIZE; i++) fn(i);
}

function focusedAddr() {
    const sec = s.focusedSection;
    return {
        sec,
        bank: focusedBankIndex(sec),
        slot: focusedSlotIndex()
    };
}

function sameAddr(a, b) {
    return !!a && !!b && a.sec === b.sec && a.bank === b.bank && a.slot === b.slot;
}

function copyAddr(a) {
    return { sec: a.sec, bank: a.bank, slot: a.slot };
}

function shouldSendNoteOffForAddr(addr) {
    const sec = clampInt(addr.sec, 0, GRID_COUNT - 1, 0);
    const bank = clampInt(addr.bank, 0, BANK_COUNT - 1, 0);
    const slot = clampInt(addr.slot, 0, GRID_SIZE - 1, 0);
    return !!slotAt(sec, bank, slot).modeGate;
}

function applySlotToDsp(sec, bank, slot, srcSlot) {
    const dst = slotAt(sec, bank, slot);
    dst.path = String(srcSlot.path || '');
    dst.attack = clampFloat(srcSlot.attack, 1.0, 5000.0, 5.0);
    dst.decay = clampFloat(srcSlot.decay, 1.0, DECAY_MAX_MS, DEFAULT_DECAY_MS);
    dst.startTrim = clampFloat(srcSlot.startTrim, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, 0.0);
    dst.endTrim = clampFloat(srcSlot.endTrim, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, 0.0);
    dst.gain = clampFloat(srcSlot.gain, 0.0, 4.0, 1.0);
    dst.pitch = clampFloat(srcSlot.pitch, -48.0, 48.0, 0.0);
    dst.modeGate = clampInt(srcSlot.modeGate, 0, 1, 1);
    dst.loop = clampInt(srcSlot.loop, 0, 2, 0);
    dst.reverse = clampInt(srcSlot.reverse, 0, 1, 0);
    dst.color = clampInt(srcSlot.color, -1, 127, -1);
    dst.muted = clampInt(srcSlot.muted, 0, 1, 0);

    sendSlotStateToDsp(sec, bank, slot, true);
}

function copySlotBetween(srcAddr, dstAddr) {
    if (!srcAddr || !dstAddr) return;
    const src = cloneSlot(slotAt(srcAddr.sec, srcAddr.bank, srcAddr.slot));
    applySlotToDsp(dstAddr.sec, dstAddr.bank, dstAddr.slot, src);
    markLedsDirty();
    markSessionChanged();
}

function clearFocusedPadAudio() {
    const a = focusedAddr();
    const sl = slotAt(a.sec, a.bank, a.slot);
    if (sl.path) {
        setSlotPath(a.sec, a.bank, a.slot, '', true);
        showStatus('Cleared S' + (a.sec + 1) + 'B' + (a.bank + 1) + 'P' + (a.slot + 1), 100);
        s.dirty = true;
        return true;
    }

    const bank = s.sections[a.sec].banks[a.bank];
    if (s.sections[a.sec].mode === MODE_SINGLE && bank.sourcePath) {
        setSourcePath(a.sec, a.bank, '', true);
        showStatus('Cleared S' + (a.sec + 1) + 'B' + (a.bank + 1) + ' source', 100);
        s.dirty = true;
        return true;
    }

    showStatus('Pad already empty', 90);
    return false;
}

function clearFocusedBankAudio() {
    const sec = s.focusedSection;
    const bankIdx = focusedBankIndex(sec);
    const bank = s.sections[sec].banks[bankIdx];

    let changed = false;
    if (bank.sourcePath) {
        setSourcePath(sec, bankIdx, '', true);
        changed = true;
    }
    for (let slot = 0; slot < GRID_SIZE; slot++) {
        if (!bank.slots[slot].path) continue;
        setSlotPath(sec, bankIdx, slot, '', true);
        changed = true;
    }

    if (!changed) {
        showStatus('Bank already empty', 90);
        return false;
    }

    showStatus('Cleared S' + (sec + 1) + 'B' + (bankIdx + 1) + ' audio', 100);
    s.dirty = true;
    return true;
}

function sendSlotStateToDsp(sec, bank, slot, blocking, forceDirect) {
    const sl = slotAt(sec, bank, slot);
    const send = blocking ? spb : sp;
    const timeout = blocking ? 250 : 0;
    const sampleTimeout = blocking ? 1500 : timeout;

    if (sl.path) send('slot_sample_path', sec + ':' + bank + ':' + slot + ':' + sl.path, sampleTimeout);
    else send('clear_slot_sample', sec + ':' + bank + ':' + slot, timeout);

    send('slot_attack_at', fmtAt(sec, bank, slot, sl.attack.toFixed(2)), timeout);
    send('slot_decay_at', fmtAt(sec, bank, slot, sl.decay.toFixed(2)), timeout);
    send('slot_start_trim_at', fmtAt(sec, bank, slot, sl.startTrim.toFixed(2)), timeout);
    sendSlotEndTrimToDsp(sec, bank, slot, sl.endTrim.toFixed(2), timeout, !!blocking);
    send('slot_gain_at', fmtAt(sec, bank, slot, sl.gain.toFixed(3)), timeout);
    send('slot_pan_at', fmtAt(sec, bank, slot, sl.pan.toFixed(3)), timeout);
    send('slot_pitch_at', fmtAt(sec, bank, slot, sl.pitch.toFixed(2)), timeout);
    send('slot_mode_at', fmtAt(sec, bank, slot, sl.modeGate), timeout);
    send('slot_loop_at', fmtAt(sec, bank, slot, sl.loop), timeout);
    send('slot_reverse_at', fmtAt(sec, bank, slot, sl.reverse ? 1 : 0), timeout);

    if (
        forceDirect ||
        (sec === s.focusedSection && bank === focusedBankIndex(sec) && slot === focusedSlotIndex())
    ) {
        const directTimeout = blocking ? 180 : 120;
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_attack', sl.attack.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_decay', sl.decay.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_start_trim', sl.startTrim.toFixed(2), directTimeout, !!blocking);
        sendSlotEndTrimToDsp(sec, bank, slot, sl.endTrim.toFixed(2), directTimeout, true, true);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_gain', sl.gain.toFixed(3), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_pan', sl.pan.toFixed(3), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_pitch', sl.pitch.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_mode', sl.modeGate, directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_loop', sl.loop, directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_reverse', sl.reverse ? 1 : 0, directTimeout, !!blocking);
    }
}

function sendBankToneStateToDsp(sec, bank) {
    const b = s.sections[sec].banks[bank];
    spb('section_filter_type', sec + ':' + bank + ':' + clampInt(b.filterType, 0, FILTER_TYPES.length - 1, 0), 120);
    spb('section_filter_amount', sec + ':' + bank + ':' + clampFloat(b.filterValue, 0.0, 1.0, 0.5).toFixed(3), 120);
    spb('section_emulation_preset', sec + ':' + bank + ':' + clampInt(b.emulationPreset, 0, EMULATION_PRESETS.length - 1, 0), 120);
}

function bankFxEffect(sec, bank, effectIdx) {
    const b = s.sections[sec].banks[bank];
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    if (!Array.isArray(b.fxEffects)) b.fxEffects = createFxEffectArray('bank');
    return b.fxEffects[idx];
}

function globalFxEffect(effectIdx) {
    const idx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    if (!Array.isArray(s.globalFxEffects)) s.globalFxEffects = createFxEffectArray('global');
    return s.globalFxEffects[idx];
}

function fxEffectsForScope(scope, sec, bank) {
    if (scope === 'global') return Array.isArray(s.globalFxEffects) ? s.globalFxEffects : (s.globalFxEffects = createFxEffectArray('global'));
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    const b = s.sections[sSec].banks[sBank];
    if (!Array.isArray(b.fxEffects)) b.fxEffects = createFxEffectArray('bank');
    return b.fxEffects;
}

function fxEnabledOwnerForDsp(scope, sec, bank, dspFx, preferredIdx) {
    const effects = fxEffectsForScope(scope, sec, bank);
    const preferred = clampInt(preferredIdx, 0, FX_EFFECT_COUNT - 1, 0);
    let firstMapped = -1;
    let firstEnabled = -1;
    for (let i = 0; i < FX_EFFECT_COUNT; i++) {
        if (fxDspIndex(i, scope) !== dspFx) continue;
        if (firstMapped < 0) firstMapped = i;
        const eff = effects[i];
        const enabled = clampInt(eff && eff.enabled, 0, 1, 0);
        if (!enabled) continue;
        if (i === preferred) return i;
        if (firstEnabled < 0) firstEnabled = i;
    }
    if (firstEnabled >= 0) return firstEnabled;
    return firstMapped;
}

function sendFxToggleToDsp(scope, sec, bank, effectIdx) {
    const fxIdx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const dspFx = fxDspIndex(fxIdx, scope);
    const ownerIdx = fxEnabledOwnerForDsp(scope, sec, bank, dspFx, fxIdx);
    const effects = fxEffectsForScope(scope, sec, bank);
    const owner = ownerIdx >= 0 ? effects[ownerIdx] : null;
    const enabled = clampInt(owner && owner.enabled, 0, 1, 0);
    if (scope === 'global') {
        sp('performance_fx_global_toggle', dspFx + ':' + enabled);
        sp('pfx_global_toggle', dspFx + ':' + enabled);
        return;
    }
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    sp('performance_fx_bank_toggle', sSec + ':' + sBank + ':' + dspFx + ':' + enabled);
    sp('pfx_bank_toggle', sSec + ':' + sBank + ':' + dspFx + ':' + enabled);
}

function sendFxParamToDsp(scope, sec, bank, effectIdx, paramIdx) {
    const fxIdx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const dspFx = fxDspIndex(fxIdx, scope);
    const p = clampInt(paramIdx, 0, FX_PARAM_COUNT - 1, 0);
    const effects = fxEffectsForScope(scope, sec, bank);
    const ownerIdx = fxEnabledOwnerForDsp(scope, sec, bank, dspFx, fxIdx);
    const owner = ownerIdx >= 0 ? effects[ownerIdx] : null;
    const ownerEnabled = clampInt(owner && owner.enabled, 0, 1, 0) > 0;
    const ownerEffectIdx = ownerIdx >= 0 ? ownerIdx : fxIdx;
    const fallback = defaultFxParam(ownerEffectIdx, p, scope);
    const raw = ownerEnabled && owner && Array.isArray(owner.params) ? owner.params[p] : fallback;
    const v = normalizeFxParam(ownerEffectIdx, p, raw, fallback);
    if (scope === 'global') {
        sp('performance_fx_global_param', dspFx + ':' + p + ':' + v.toFixed(3));
        sp('pfx_global_param', dspFx + ':' + p + ':' + v.toFixed(3));
        return;
    }
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    sp('performance_fx_bank_param', sSec + ':' + sBank + ':' + dspFx + ':' + p + ':' + v.toFixed(3));
    sp('pfx_bank_param', sSec + ':' + sBank + ':' + dspFx + ':' + p + ':' + v.toFixed(3));
}

function sendFxStateToDsp(scope, sec, bank, effectIdx) {
    const fxIdx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    sendFxToggleToDsp(scope, sec, bank, fxIdx);
    for (let p = 0; p < FX_PARAM_COUNT; p++) sendFxParamToDsp(scope, sec, bank, fxIdx, p);
}
function fxDspIndexIsVisible(dspFxIdx) {
    const target = clampInt(dspFxIdx, 0, DSP_FX_COUNT - 1, 0);
    for (let i = 0; i < FX_EFFECT_COUNT; i++) {
        if (fxDspIndex(i, 'bank') === target) return true;
        if (fxDspIndex(i, 'global') === target) return true;
    }
    return false;
}
function sendHiddenFxOffToDsp() {
    for (let dspFx = 0; dspFx < DSP_FX_COUNT; dspFx++) {
        if (fxDspIndexIsVisible(dspFx)) continue;
        sp('performance_fx_global_toggle', dspFx + ':0');
        sp('pfx_global_toggle', dspFx + ':0');
        for (let sec = 0; sec < GRID_COUNT; sec++) {
            for (let bank = 0; bank < BANK_COUNT; bank++) {
                const payload = sec + ':' + bank + ':' + dspFx + ':0';
                sp('performance_fx_bank_toggle', payload);
                sp('pfx_bank_toggle', payload);
            }
        }
    }
}

function applyBankStateToDsp(sec, bank, blockingSlots, forceDirect) {
    const b = s.sections[sec].banks[bank];
    b.chopCount = SOURCE_CHOP_COUNT;
    b.slicePage = 0;

    spb('section_source_play_mode', sec + ':' + bank + ':' + sourcePlayModeForSection(sec), 300);
    spb('section_chop_count', sec + ':' + bank + ':' + SOURCE_CHOP_COUNT, 300);
    spb('section_transient_sensitivity', sec + ':' + bank + ':' + normalizeTransientSensitivity(b.transientSensitivity), 300);
    spb('section_source_path', sec + ':' + bank + ':' + (b.sourcePath || ''), 500);

    const slicePayload = serializeSliceStarts(b.sliceStarts, b.chopCount);
    if (slicePayload && b.sourcePath) {
        spb('section_slice_starts', sec + ':' + bank + ':' + slicePayload, 500);
    }

    spb('section_slice_page', sec + ':' + bank + ':0', 300);

    for (let slot = 0; slot < GRID_SIZE; slot++) {
        sendSlotStateToDsp(sec, bank, slot, !!blockingSlots, !!forceDirect);
    }
    sendBankToneStateToDsp(sec, bank);
    for (let fx = 0; fx < FX_EFFECT_COUNT; fx++) sendFxStateToDsp('bank', sec, bank, fx);
    if (sec === s.focusedSection && bank === focusedBankIndex(sec)) {
        invalidatePlaybackCompat();
    }
}

function toggleEditScope() {
    s.editScope = s.editScope === 'P' ? 'G' : 'P';
    showStatus('Scope ' + (s.editScope === 'P' ? 'Pad' : 'Bank'), 80);
    markSessionChanged();
    s.dirty = true;
}

function propagateFocusedSourceBank() {
    const sec = s.focusedSection;
    if (s.sections[sec].mode !== MODE_SINGLE) {
        showStatus('Source mode only', 90);
        return;
    }

    const srcBank = focusedBankIndex(sec);
    const src = cloneBank(s.sections[sec].banks[srcBank]);
    for (let bank = 0; bank < BANK_COUNT; bank++) {
        if (bank === srcBank) continue;
        const keepColor = s.sections[sec].banks[bank].bankColor;
        s.sections[sec].banks[bank] = cloneBank(src);
        s.sections[sec].banks[bank].bankColor = keepColor;
        applyBankStateToDsp(sec, bank);
    }

    showStatus('S' + (sec + 1) + ' source -> banks', 110);
    markLedsDirty();
    markSessionChanged();
    s.dirty = true;
}

function padNoteFor(sec, slot) {
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sSlot = clampInt(slot, 0, GRID_SIZE - 1, 0);
    const row = Math.floor(sSlot / SECTION_COLS);
    const col = (sSec * SECTION_COLS) + (sSlot % SECTION_COLS);
    return PAD_NOTE_MIN + row * PAD_COLS + col;
}

function stepTargetFromNote(note) {
    if (note < STEP_NOTE_MIN || note > STEP_NOTE_MAX) return null;
    if (note <= 23) return { sec: 0, bank: note - STEP_NOTE_MIN };
    return { sec: 1, bank: note - 24 };
}

function stepNoteFor(sec, bank) {
    if (sec === 0) return STEP_NOTE_MIN + clampInt(bank, 0, BANK_COUNT - 1, 0);
    return 24 + clampInt(bank, 0, BANK_COUNT - 1, 0);
}

function effectivePadColor(sec, bankIdx, slotIdx) {
    const bank = s.sections[sec].banks[bankIdx];
    const slot = bank.slots[slotIdx];
    const playbackState = s.padPlaybackState[addrKey(sec, bankIdx, slotIdx)] || 'idle';
    if (slot.loop > 0 && playbackState !== 'idle') return PAD_PRESS_LED_COLOR;
    const pressKey = sec + ':' + bankIdx + ':' + slotIdx;
    const flashUntil = clampInt(s.padPressFlash[pressKey], 0, 0x7fffffff, 0);
    if (flashUntil > s.transportTicks) return PAD_PRESS_LED_COLOR;
    if (slot.muted) return 1;
    const base = normalizeColor(bank.bankColor, defaultBankColor(bankIdx));
    const slotColor = clampInt(slot.color, -1, 127, -1);
    return slotColor >= 0 ? slotColor : base;
}

function rebuildLedQueue() {
    s.ledQueue = [];

    if (s.view === 'fx') {
        const sec = s.focusedSection;
        const bank = focusedBankIndex(sec);
        /* Prioritize step LEDs so bank state remains stable even under frequent queue rebuilds. */
        if (USE_STEP_BANKS) {
            for (let note = STEP_NOTE_MIN; note <= STEP_NOTE_MAX; note++) s.ledQueue.push([note, 0]);
        }
        for (let gridSec = 0; gridSec < GRID_COUNT; gridSec++) {
            for (let slot = 0; slot < GRID_SIZE; slot++) {
                const note = padNoteFor(gridSec, slot);
                let color = Black;
                const fxIdx = fxEffectFromPadSlot(slot);
                if (fxIdx >= 0) {
                    const bankRow = gridSec === 0;
                    const eff = bankRow ? bankFxEffect(sec, bank, fxIdx) : globalFxEffect(fxIdx);
                    color = fxLedColor(bankRow ? 'bank' : 'global', fxIdx, !!eff.enabled);
                }
                s.ledQueue.push([note, color]);
            }
        }
        s.ledsDirty = false;
        return;
    }

    if (USE_STEP_BANKS) {
        for (let note = STEP_NOTE_MIN; note <= STEP_NOTE_MAX; note++) {
            s.ledQueue.push([note, 124]);
        }
        s.ledQueue.push([STEP_NOTE_MIN + s.sections[0].currentBank, normalizeColor(s.sections[0].banks[s.sections[0].currentBank].bankColor, 120)]);
        if (!LEFT_GRID_ONLY) {
            s.ledQueue.push([24 + s.sections[1].currentBank, normalizeColor(s.sections[1].banks[s.sections[1].currentBank].bankColor, 120)]);
        }
        if (s.stepCopySource) {
            if (LEFT_GRID_ONLY && s.stepCopySource.sec !== 0) s.stepCopySource = null;
            if (s.stepCopySource) {
                s.ledQueue.push([stepNoteFor(s.stepCopySource.sec, s.stepCopySource.bank), 120]);
            }
        }
        if (s.loopPadMode) {
            const l = currentLooper();
            if (l && Array.isArray(l.events) && l.events.length) {
                const used = [
                    Array.from({ length: BANK_COUNT }, () => false),
                    Array.from({ length: BANK_COUNT }, () => false)
                ];
                for (let i = 0; i < l.events.length; i++) {
                    const ev = l.events[i];
                    if (!ev || ev.type !== 'on') continue;
                    const sec = clampInt(ev.sec, 0, GRID_COUNT - 1, 0);
                    const bank = clampInt(ev.bank, 0, BANK_COUNT - 1, 0);
                    used[sec][bank] = true;
                }
                const blinkOn = (l.state === 'playing' || l.state === 'overdub')
                    ? ((s.transportTicks % STEP_BANK_BLINK_PERIOD_TICKS) < Math.floor(STEP_BANK_BLINK_PERIOD_TICKS / 2))
                    : true;
                const markColor = blinkOn ? 120 : 124;
                for (let sec = 0; sec < GRID_COUNT; sec++) {
                    if (LEFT_GRID_ONLY && sec !== 0) continue;
                    for (let bank = 0; bank < BANK_COUNT; bank++) {
                        if (!used[sec][bank]) continue;
                        s.ledQueue.push([stepNoteFor(sec, bank), markColor]);
                    }
                }
            }
        }
    }

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        const bankIdx = s.sections[sec].currentBank;
        for (let slot = 0; slot < GRID_SIZE; slot++) {
            const note = padNoteFor(sec, slot);
            let color = (LEFT_GRID_ONLY && sec === 1) ? 0 : effectivePadColor(sec, bankIdx, slot);
            let loopPad = false;
            if (s.loopPadMode) {
                const lp = loopPadIndexFromPadNote(note);
                if (lp >= 0) {
                    color = looperStateColor(s.midiLoopers[lp].state);
                    loopPad = true;
                }
            }
            if (!loopPad && s.copySource && s.copySource.sec === sec && s.copySource.bank === bankIdx && s.copySource.slot === slot) {
                color = 120;
            }
            s.ledQueue.push([note, color]);
        }
    }

    s.ledsDirty = false;
}

function drainLedQueue() {
    if (!s.ledQueue.length) {
        if (s.ledsDirty) rebuildLedQueue();
        if (!s.ledQueue.length) return;
    }

    const count = Math.min(LEDS_PER_TICK, s.ledQueue.length);
    for (let i = 0; i < count; i++) {
        const entry = s.ledQueue.shift();
        setLED(entry[0], entry[1]);
    }
}

function forceLedRefreshNow() {
    s.ledsDirty = true;
    rebuildLedQueue();
    while (s.ledQueue.length) {
        const entry = s.ledQueue.shift();
        setLED(entry[0], entry[1]);
    }
    updateRecordButtonLed();
    updateUtilityButtonLeds();
}

function refreshRealtimeUiState() {
    editCursorCache.sec = -1;
    editCursorCache.bank = -1;
    editCursorCache.slot = -1;
    ensureEditCursor(true);
    invalidatePlaybackCompat();
    syncFocusedSlotPlaybackCompat(true);
    forceLedRefreshNow();
    s.ledResyncPasses = LED_RESYNC_PASSES;
    s.ledResyncTicks = LED_RESYNC_INTERVAL_TICKS;
}

function tickLedResync() {
    if (s.ledResyncPasses <= 0) return;
    if (s.ledResyncTicks > 0) {
        s.ledResyncTicks--;
        return;
    }
    s.ledResyncPasses--;
    s.ledResyncTicks = LED_RESYNC_INTERVAL_TICKS;
    markLedsDirty();
    updateRecordButtonLed();
}

function adjustFocusedBankColor(delta) {
    const sec = s.focusedSection;
    const bankIdx = focusedBankIndex(sec);
    const bank = s.sections[sec].banks[bankIdx];
    const fallback = defaultBankColor(bankIdx);
    const next = cycleInPalette(normalizeColor(bank.bankColor, fallback), COLOR_PALETTE, delta, fallback);
    bank.bankColor = next;
    showStatus('S' + (sec + 1) + 'B' + (bankIdx + 1) + ' color ' + next, 80);
    markLedsDirty();
    markSessionChanged();
}

function adjustFocusedPadColor(delta) {
    const a = focusedAddr();
    const slot = slotAt(a.sec, a.bank, a.slot);
    const next = cycleInPalette(clampInt(slot.color, -1, 127, -1), PAD_COLOR_SEQUENCE, delta, -1);
    slot.color = next;
    showStatus('S' + (a.sec + 1) + 'B' + (a.bank + 1) + 'P' + (a.slot + 1) + ' color ' + (next < 0 ? 'BANK' : next), 90);
    markLedsDirty();
    markSessionChanged();
}

function adjustPadAttack(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).attack + delta * 5.0;
    setSlotAttack(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' Atk ' + Math.round(slotAt(a.sec, a.bank, a.slot).attack), 80);
    s.dirty = true;
}

function steppedDecayValue(current, delta) {
    const cur = clampFloat(current, 1.0, DECAY_MAX_MS, DEFAULT_DECAY_MS);
    if (delta > 0 && cur >= SOURCE_MODE_DEFAULT_DECAY_MS && cur < DECAY_MAX_MS) return DECAY_MAX_MS;
    if (delta < 0 && cur >= DECAY_MAX_MS) return SOURCE_MODE_DEFAULT_DECAY_MS;
    return cur + delta * 20.0;
}

function adjustPadDecay(delta) {
    const a = focusedAddr();
    const v = steppedDecayValue(slotAt(a.sec, a.bank, a.slot).decay, delta);
    setSlotDecay(a.sec, a.bank, a.slot, v);
    const next = slotAt(a.sec, a.bank, a.slot).decay;
    showStatus('P' + (a.slot + 1) + ' Dec ' + (next >= DECAY_MAX_MS ? 'INF' : Math.round(next)), 80);
    s.dirty = true;
}

function adjustPadStartTrim(delta) {
    const a = focusedAddr();
    const loopActive = clampInt(slotAt(a.sec, a.bank, a.slot).loop, 0, 2, 0) > 0;
    const silentTrimEdit = !s.startTrimSoundingEnabled && !loopActive;
    if (silentTrimEdit) stopFocusedPadAudioForTrimEdit();
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    const v = slotAt(a.sec, a.bank, a.slot).startTrim + delta * step;
    setSlotStartTrim(a.sec, a.bank, a.slot, v, true);
    if (!silentTrimEdit) retriggerFocusedPadForStartTrim();
    showStatus('P' + (a.slot + 1) + ' Start ' + Math.round(slotAt(a.sec, a.bank, a.slot).startTrim), 80);
    s.dirty = true;
}

function adjustPadEndTrim(delta) {
    const a = focusedAddr();
    const loopActive = clampInt(slotAt(a.sec, a.bank, a.slot).loop, 0, 2, 0) > 0;
    const silentTrimEdit = !s.startTrimSoundingEnabled && !loopActive;
    if (silentTrimEdit) stopFocusedPadAudioForTrimEdit();
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    const v = slotAt(a.sec, a.bank, a.slot).endTrim + delta * step;
    setSlotEndTrim(a.sec, a.bank, a.slot, v, true);
    if (!silentTrimEdit) retriggerFocusedPadForStartTrim();
    showStatus('P' + (a.slot + 1) + ' End ' + Math.round(slotAt(a.sec, a.bank, a.slot).endTrim), 80);
    s.dirty = true;
}

function consumeBinaryKnobTurn(actionKey, delta) {
    const key = String(actionKey || '');
    if (!key || delta === 0) return false;

    const nowMs = Date.now();
    const sign = delta > 0 ? 1 : -1;
    const existing = s.binaryKnobState[key] || { accum: 0, sign: 0, lastAtMs: 0, cooldownUntilMs: 0 };

    if (nowMs < clampInt(existing.cooldownUntilMs, 0, 0x7fffffff, 0)) {
        existing.accum = 0;
        existing.sign = sign;
        existing.lastAtMs = nowMs;
        s.binaryKnobState[key] = existing;
        return false;
    }

    if (existing.sign !== 0 && existing.sign !== sign) existing.accum = 0;
    if (nowMs - clampInt(existing.lastAtMs, 0, 0x7fffffff, 0) > BINARY_KNOB_TURN_IDLE_RESET_MS) existing.accum = 0;

    existing.accum += delta;
    existing.sign = sign;
    existing.lastAtMs = nowMs;

    if (Math.abs(existing.accum) < BINARY_KNOB_TURN_THRESHOLD) {
        s.binaryKnobState[key] = existing;
        return false;
    }

    existing.accum = 0;
    existing.cooldownUntilMs = nowMs + BINARY_KNOB_TOGGLE_COOLDOWN_MS;
    s.binaryKnobState[key] = existing;
    return true;
}

function togglePadMode() {
    const a = focusedAddr();
    const cur = slotAt(a.sec, a.bank, a.slot).modeGate;
    setSlotMode(a.sec, a.bank, a.slot, cur ? 0 : 1);
    showStatus('P' + (a.slot + 1) + ' ' + (slotAt(a.sec, a.bank, a.slot).modeGate ? 'Gate' : 'Trig'), 80);
    s.dirty = true;
}

function adjustPadPitch(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).pitch + delta * 0.5;
    setSlotPitch(a.sec, a.bank, a.slot, v);
    const refreshed = refreshActiveLoopVoiceForPitch(a.sec, a.bank, a.slot);
    if (!refreshed) retriggerHeldFocusedSourcePadForPitch();
    showStatus('P' + (a.slot + 1) + ' Pitch ' + slotAt(a.sec, a.bank, a.slot).pitch.toFixed(1), 80);
    s.dirty = true;
}

function adjustPadGain(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).gain + delta * 0.05;
    setSlotGain(a.sec, a.bank, a.slot, v, true);
    refreshActiveLoopVoiceForGain(a.sec, a.bank, a.slot);
    showStatus('P' + (a.slot + 1) + ' Gain x' + slotAt(a.sec, a.bank, a.slot).gain.toFixed(2), 80);
    s.dirty = true;
}

function adjustPadPan(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).pan + delta * 0.05;
    setSlotPan(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' Pan ' + slotAt(a.sec, a.bank, a.slot).pan.toFixed(2), 80);
    s.dirty = true;
}

function retriggerHeldFocusedSourcePadForPitch() {
    if (!SOURCE_PITCH_LIVE_RETRIGGER) return;

    const sec = s.focusedSection;
    if (s.sections[sec].mode !== MODE_SINGLE) return;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();

    const keys = Object.keys(s.activePadPress);
    for (let i = 0; i < keys.length; i++) {
        const press = s.activePadPress[keys[i]];
        if (!press) continue;
        if (press.sec !== sec || press.bank !== bank || press.slot !== slot) continue;

        const note = clampInt(press.triggerNote, PAD_NOTE_MIN, PAD_NOTE_MAX, padNoteFor(sec, slot));
        const velocity = clampInt(press.velocity, 1, 127, 100);
        triggerPadOn(sec, bank, slot, velocity, false, false, 'pitch-retrigger:' + String(note));
        return;
    }
}

function refreshActiveLoopVoiceForPitch(sec, bank, slot) {
    if (!SOURCE_PITCH_LIVE_RETRIGGER) return false;

    const sl = slotAt(sec, bank, slot);
    if (clampInt(sl.loop, 0, 2, 0) <= 0) return false;

    const voice = currentVoiceAt(sec, bank, slot);
    if (!voice) return false;
    if (s.sections[sec].mode === MODE_SINGLE) return true;

    const velocity = clampInt(voice.velocity, 1, 127, 127);
    const sourceTag = 'pitch-loop-refresh:' + String(sec) + ':' + String(bank) + ':' + String(slot);
    return refreshActiveLoopVoiceForTrim(sec, bank, slot, velocity, !!voice.routeBank, sourceTag);
}

function refreshActiveLoopVoicesInBankForPitch(sec, bank) {
    let refreshed = false;
    for (let slot = 0; slot < GRID_SIZE; slot++) {
        if (refreshActiveLoopVoiceForPitch(sec, bank, slot)) refreshed = true;
    }
    return refreshed;
}

function refreshActiveLoopVoiceForGain(sec, bank, slot) {
    const sl = slotAt(sec, bank, slot);
    if (clampInt(sl.loop, 0, 2, 0) <= 0) return false;
    const voice = currentVoiceAt(sec, bank, slot);
    if (!voice) return false;
    const velocity = clampInt(voice.velocity, 1, 127, 127);
    const sourceTag = 'gain-loop-refresh:' + String(sec) + ':' + String(bank) + ':' + String(slot);
    return refreshActiveLoopVoiceForTrim(sec, bank, slot, velocity, !!voice.routeBank, sourceTag);
}

function refreshOtherActiveLoopVoices(sec, bank, slot) {
    const keys = Object.keys(activeVoicesByAddr);
    for (let i = 0; i < keys.length; i++) {
        const v = activeVoicesByAddr[keys[i]];
        if (!v) continue;
        if (v.sec === sec && v.bank === bank && v.slot === slot) continue;
        const sl = slotAt(v.sec, v.bank, v.slot);
        if (clampInt(sl.loop, 0, 2, 0) <= 0) continue;
        const vel = clampInt(v.velocity, 1, 127, 127);
        refreshActiveLoopVoiceForTrim(
            v.sec,
            v.bank,
            v.slot,
            vel,
            !!v.routeBank,
            'loop-anti-choke:' + String(sec) + ':' + String(bank) + ':' + String(slot)
        );
    }
}

function retriggerFocusedPadForStartTrim() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    const voice = currentVoiceAt(sec, bank, slot);

    let velocity = -1;
    const keys = Object.keys(s.activePadPress);
    for (let i = 0; i < keys.length; i++) {
        const press = s.activePadPress[keys[i]];
        if (!press) continue;
        if (press.sec !== sec || press.bank !== bank || press.slot !== slot) continue;
        velocity = clampInt(press.velocity, 1, 127, 100);
        break;
    }

    const sl = slotAt(sec, bank, slot);
    s.trimPreviewSerial = clampInt(s.trimPreviewSerial + 1, 0, 0x7fffffff, 1);
    if (voice && clampInt(sl.loop, 0, 2, 0) > 0) {
        const loopVelocity = velocity >= 1 ? velocity : clampInt(voice.velocity, 1, 127, 127);
        const sourceTag = 'trim-loop-preview:' + String(s.trimPreviewSerial);
        refreshActiveLoopVoiceForTrim(sec, bank, slot, loopVelocity, !!voice.routeBank, sourceTag);
        return;
    }

    if (velocity < 1) return;

    const sourceTag = 'starttrim-preview:' + String(s.trimPreviewSerial);
    if (!triggerPadOn(sec, bank, slot, velocity, false, false, sourceTag)) return;
    triggerPadOff(sec, bank, slot, false, false);
}

function refreshActiveLoopVoiceForTrim(sec, bank, slot, velocity, routeBank, sourceTag) {
    if (isPadMuted(sec, bank, slot)) return false;
    flashPadPress(sec, bank, slot);
    s.lastPadTriggerTick = s.transportTicks;
    clearPendingOff(sec, bank, slot);

    const triggerNote = padNoteFor(sec, slot);
    const vel = s.velocitySens ? clampInt(velocity, 1, 127, 100) : 127;
    const loopMode = clampInt(slotAt(sec, bank, slot).loop, 0, 2, 0);
    const effectiveRouteBank = (loopMode > 0) ? true : !!routeBank;
    if (effectiveRouteBank) {
        withPlaybackBank(sec, bank, () => {
            spe('pad_note_on', triggerNote + ':' + vel);
        });
    } else {
        spe('pad_note_on', triggerNote + ':' + vel);
    }
    sendMidiOut(slot, vel, sec, bank, true);

    const nowMs = Date.now();
    const key = addrKey(sec, bank, slot);
    const src = String(sourceTag || '');
    const existing = activeVoicesByAddr[key] || { sec, bank, slot };
    existing.sec = sec;
    existing.bank = bank;
    existing.slot = slot;
    existing.routeBank = !!effectiveRouteBank;
    existing.owner = src;
    existing.sourceTag = src;
    existing.velocity = vel;
    existing.startedMs = nowMs;
    existing.lastOnMs = nowMs;
    activeVoicesByAddr[key] = existing;
    setPadPlaybackState(sec, bank, slot, 'playing');
    markLedsDirty();
    return true;
}

function stopFocusedPadAudioForTrimEdit() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    const key = addrKey(sec, bank, slot);
    const voice = activeVoicesByAddr[key];
    if (!voice) return;
    releaseActiveVoice(voice.sec, voice.bank, voice.slot, !!voice.routeBank, false, Date.now(), true);
}

function adjustPadLoop(delta) {
    const a = focusedAddr();
    const cur = slotAt(a.sec, a.bank, a.slot).loop;
    const next = clamp(cur + (delta > 0 ? 1 : -1), 0, 2);
    setSlotLoop(a.sec, a.bank, a.slot, next, true);
    showStatus('P' + (a.slot + 1) + ' Loop ' + LOOP_LABELS[slotAt(a.sec, a.bank, a.slot).loop], 80);
    s.dirty = true;
}

function adjustGlobalGain(delta) {
    s.globalGain = clamp(s.globalGain + delta * 0.05, 0.0, 4.0);
    sp('global_gain', s.globalGain.toFixed(3));
    showStatus('Global gain x' + s.globalGain.toFixed(2), 80);
    markSessionChanged();
    s.dirty = true;
}

function adjustGlobalPitch(delta) {
    s.globalPitch = clamp(s.globalPitch + delta * 0.5, -48.0, 48.0);
    sp('global_pitch', s.globalPitch.toFixed(2));
    showStatus('Global pitch ' + s.globalPitch.toFixed(1), 80);
    markSessionChanged();
    s.dirty = true;
}

function toggleVelocitySens() {
    s.velocitySens = s.velocitySens ? 0 : 1;
    spb('velocity_sens', String(s.velocitySens), 120);
    showStatus(s.velocitySens ? 'Pad Velocity ON' : 'Pad Velocity OFF (Full)', 80);
    markSessionChanged();
    s.dirty = true;
}

function applyAllSlotsInFocusedBank(op) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    forEachSlotInBank(sec, bank, (slot) => op(sec, bank, slot));
    s.dirty = true;
}

function adjustAllAttack(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).attack + delta * 5.0;
        setSlotAttack(sec, bank, slot, v, true);
    });
    showStatus('All atk ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).attack), 80);
}

function adjustAllDecay(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = steppedDecayValue(slotAt(sec, bank, slot).decay, delta);
        setSlotDecay(sec, bank, slot, v, true);
    });
    const next = slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).decay;
    showStatus('All dec ' + (next >= DECAY_MAX_MS ? 'INF' : Math.round(next)), 80);
}

function adjustFocusedBankFilter(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const b = s.sections[sec].banks[bank];
    const typeValues = Array.from({ length: FILTER_TYPES.length }, (_, i) => i);
    if (s.sections[sec].mode === MODE_SINGLE) b.filterType = cycleInPalette(clampInt(b.filterType, 0, FILTER_TYPES.length - 1, 0), typeValues, delta, 0);
    else b.filterValue = clamp(clampFloat(b.filterValue, 0.0, 1.0, 0.5) + delta * 0.03, 0.0, 1.0);
    sendBankToneStateToDsp(sec, bank);
    showStatus('B' + (bank + 1) + ' Filter ' + FILTER_TYPES[clampInt(b.filterType, 0, FILTER_TYPES.length - 1, 0)] + ' ' + Math.round(clampFloat(b.filterValue, 0.0, 1.0, 0.5) * 100) + '%', 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustFocusedBankEmulation(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const b = s.sections[sec].banks[bank];
    const next = clamp(clampInt(b.emulationPreset, 0, EMULATION_PRESETS.length - 1, 0) + (delta > 0 ? 1 : -1), 0, EMULATION_PRESETS.length - 1);
    if (next === b.emulationPreset) return;
    b.emulationPreset = next;
    sendBankToneStateToDsp(sec, bank);
    showStatus('B' + (bank + 1) + ' Tone ' + EMULATION_PRESETS[next], 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustAllStartTrim(delta) {
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).startTrim + delta * step;
        setSlotStartTrim(sec, bank, slot, v, true);
    });
    showStatus('All start ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).startTrim), 80);
}

function adjustAllEndTrim(delta) {
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).endTrim + delta * step;
        setSlotEndTrim(sec, bank, slot, v, true);
    });
    showStatus('All end ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).endTrim), 80);
}

function toggleAllMode() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const first = slotAt(sec, bank, 0).modeGate;
    const next = first ? 0 : 1;
    forEachSlotInBank(sec, bank, (slot) => setSlotMode(sec, bank, slot, next, true));
    showStatus('All mode ' + (next ? 'Gate' : 'Trig'), 80);
    s.dirty = true;
}

function adjustAllLoop(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    forEachSlotInBank(sec, bank, (slot) => {
        const cur = slotAt(sec, bank, slot).loop;
        const next = clamp(cur + (delta > 0 ? 1 : -1), 0, 2);
        setSlotLoop(sec, bank, slot, next, true);
    });
    showStatus('All loop ' + LOOP_LABELS[slotAt(sec, bank, 0).loop], 80);
    s.dirty = true;
}

function adjustAllGain(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).gain + delta * 0.05;
        setSlotGain(sec, bank, slot, v, true);
        refreshActiveLoopVoiceForGain(sec, bank, slot);
    });
    showStatus('All gain x' + slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).gain.toFixed(2), 80);
}

function adjustAllPan(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).pan + delta * 0.05;
        setSlotPan(sec, bank, slot, v, true);
    });
    showStatus('All pan ' + slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).pan.toFixed(2), 80);
}

function adjustFocusedBankPitch(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).pitch + delta * 0.5;
        setSlotPitch(sec, bank, slot, v);
    });
    const refreshed = refreshActiveLoopVoicesInBankForPitch(sec, bank);
    if (!refreshed) retriggerHeldFocusedSourcePadForPitch();
    showStatus('Bank pitch ' + slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).pitch.toFixed(1), 80);
}

function adjustRecordMaxSeconds(delta) {
    s.recordMaxSeconds = clamp(s.recordMaxSeconds + delta, 1, 600);
    sp('record_max_seconds', String(s.recordMaxSeconds));
    showStatus('Record max ' + s.recordMaxSeconds + 's', 70);
    markSessionChanged();
    s.dirty = true;
}

function setRecordMonitorEnabled(enabled) {
    const on = enabled ? '1' : '0';
    s.recordMonitorOn = !!enabled;
    /* Compatibility fan-out: only supported keys will have effect in DSP. */
    sp('record_monitor', on);
    sp('input_monitor', on);
    sp('monitor_input', on);
    sp('input_thru', on);
    sp('monitor', on);
}

function setRecordState(next) {
    s.recordState = next;
    s.recordStateTicks = 0;
}

function isRecordTransitionPending() {
    return s.recordState === 'starting' || s.recordState === 'stopping';
}

function shouldPreferInternalCapture() {
    if (Object.keys(s.activePadPress).length > 0) return true;
    if ((s.transportTicks - s.lastPadTriggerTick) <= RECORD_INTENT_WINDOW_TICKS) return true;
    const looper = currentLooper();
    return looper.state === 'recording' || looper.state === 'playing' || looper.state === 'overdub';
}

function recordTargetLabel(target = s.recTarget) {
    return 'S' + (target.sec + 1) + ' B' + (target.bank + 1) + ' P' + (target.slot + 1);
}

function copyRecordTarget(target) {
    if (!target) return null;
    return {
        sec: clampInt(target.sec, 0, GRID_COUNT - 1, 0),
        bank: clampInt(target.bank, 0, BANK_COUNT - 1, 0),
        slot: clampInt(target.slot, 0, GRID_SIZE - 1, 0)
    };
}

function clearPendingRecordedPath() {
    s.recordPendingPathTicks = 0;
    s.recordPendingLoadOnStop = false;
    s.recordPendingTarget = null;
}

function latestRecordedPathCandidate() {
    const raw = String(gp('last_recorded_path', '') || '');
    if (!raw || raw === s.recordStartLastPath) return '';
    return raw;
}

function finishRecordedPath(pathRaw, shouldLoad, target) {
    const path = ensureRecordedFileInDailyFolder(pathRaw);
    const t = copyRecordTarget(target || s.recTargetLocked || s.recTarget);
    if (!path) return false;

    s.lastRecordedPath = path;
    if (t) {
        assignRecordedPathToTarget(path, t);
    } else if (shouldLoad) {
        showStatus('Recorded target missing', 90);
    } else {
        showStatus('Recorded: ' + shortText(baseName(path), 14), 90);
    }
    saveAutosaveSession(true);
    s.dirty = true;
    return true;
}

function queuePendingRecordedPath(shouldLoad, target) {
    s.recordPendingLoadOnStop = !!shouldLoad;
    s.recordPendingTarget = copyRecordTarget(target || s.recTargetLocked || s.recTarget);
    s.recordPendingPathTicks = RECORD_PATH_WAIT_TICKS;
}

function pollPendingRecordedPath() {
    if (s.recordPendingPathTicks <= 0 || s.recording) return false;

    const pathRaw = latestRecordedPathCandidate();
    if (pathRaw) {
        const shouldLoad = !!s.recordPendingLoadOnStop;
        const target = copyRecordTarget(s.recordPendingTarget);
        clearPendingRecordedPath();
        return finishRecordedPath(pathRaw, shouldLoad, target);
    }

    s.recordPendingPathTicks--;
    if (s.recordPendingPathTicks <= 0) {
        clearPendingRecordedPath();
        showStatus('Recording saved', 80);
        saveAutosaveSession(true);
        s.dirty = true;
    }
    return false;
}

function captureFocusedRecordTarget() {
    const a = focusedAddr();
    return { sec: a.sec, bank: a.bank, slot: a.slot };
}

function lockRecordingTarget(target) {
    const t = target || captureFocusedRecordTarget();
    const slice = clampInt(dspSliceFromSecSlot(t.sec, t.slot), 0, TOTAL_PADS - 1, 0);
    s.recTarget = { sec: t.sec, bank: t.bank, slot: t.slot };
    s.recTargetLocked = { sec: t.sec, bank: t.bank, slot: t.slot, slice };
    /* Some DSP paths still resolve record target from section_bank + selected_slice.
       Force both deterministically before record_start. */
    spb('section_bank', t.sec + ':' + t.bank, 180);
    spb('selected_slice', String(slice), 120);
    spb('selected_slot', String(t.slot), 120);
    spb('keyboard_section', String(t.sec), 120);
    spb('edit_section', String(t.sec), 120);
    spb('edit_bank', String(t.bank), 120);
    spb('edit_slot', String(t.slot), 120);
}

function armFocusedRecording() {
    if (s.recording) return;
    s.recordArmed = true;
    setRecordState('armed');
    s.recordLoadOnStop = false;
    s.recordBlinkOn = true;
    s.recordBlinkTicks = 0;
    setRecordMonitorEnabled(true);
    showStatus('Rec armed (press Rec to start)', 90);
    updateRecordButtonLed();
    s.dirty = true;
}

function disarmFocusedRecording() {
    if (s.recording) return;
    s.recordArmed = false;
    setRecordState('idle');
    s.recordLoadOnStop = false;
    s.recordBlinkOn = false;
    s.recordBlinkTicks = 0;
    setRecordMonitorEnabled(false);
    showStatus('Rec disarmed', 70);
    updateRecordButtonLed();
    s.dirty = true;
}

function startFocusedRecording() {
    if (isRecordTransitionPending()) return;
    const a = captureFocusedRecordTarget();
    lockRecordingTarget(a);
    s.recordLoadOnStop = false;
    clearPendingRecordedPath();
    s.recordStartLastPath = String(gp('last_recorded_path', s.lastRecordedPath) || s.lastRecordedPath || '');
    s.recordArmed = true;
    setRecordState('starting');
    s.recordBlinkOn = true;
    s.recordBlinkTicks = 0;
    setRecordMonitorEnabled(true);

    const preferInternal = shouldPreferInternalCapture();
    spb('record_target', a.sec + ':' + a.bank + ':' + a.slot, 180);
    spb('record_capture_mode', preferInternal ? 'internal' : 'auto', 180);
    spb('record_input_channels', 'stereo', 180);
    spb('record_input_stereo', '1', 180);
    spb('record_intent_internal', preferInternal ? '1' : '0', 180);
    sp('monitor_policy', '1');
    sp('debug_capture_logs', '0');
    const recDir = recordingsDayDir(Date.now());
    if (ensureDirRecursive(recDir)) sp('record_output_dir', recDir);
    sp('record_max_seconds', String(s.recordMaxSeconds));
    sp('record_start', '1');

    showStatus('REC lock ' + recordTargetLabel(a), 90);
    s.dirty = true;
}

function stopFocusedRecording(loadOnStop) {
    if (!s.recording || isRecordTransitionPending()) return;
    s.recordLoadOnStop = !!loadOnStop;
    s.recordArmed = false;
    setRecordState('stopping');
    s.recordBlinkOn = false;
    s.recordBlinkTicks = 0;
    setRecordMonitorEnabled(false);
    sp('record_stop', '1');
    updateRecordButtonLed();
    s.dirty = true;
}

function assignRecordedPathToTarget(path, target) {
    const t = target || s.recTarget;
    if (!t || !path) return false;

    const sec = clampInt(t.sec, 0, GRID_COUNT - 1, 0);
    const bank = clampInt(t.bank, 0, BANK_COUNT - 1, 0);
    const slot = clampInt(t.slot, 0, GRID_SIZE - 1, 0);
    const assignTarget = resolveAssignTarget(sec);

    if (assignTarget === 'source') {
        const existing = s.sections[sec].banks[bank].sourcePath;
        if (existing && existing !== path) showStatus('Recorded overwrite source S' + (sec + 1) + 'B' + (bank + 1), 80);
        setSourcePath(sec, bank, path, true);
        showStatus('Recorded+loaded source S' + (sec + 1) + 'B' + (bank + 1), 110);
        return true;
    }

    const existing = slotAt(sec, bank, slot).path;
    if (existing && existing !== path) showStatus('Recorded overwrite ' + recordTargetLabel({ sec, bank, slot }), 80);
    setSlotPath(sec, bank, slot, path, true);
    showStatus('Recorded+loaded ' + recordTargetLabel({ sec, bank, slot }), 110);
    return true;
}

function toggleFocusedRecording() {
    if (s.recording) {
        stopFocusedRecording(false);
        return;
    }
    if (s.recordArmed) {
        startFocusedRecording();
        return;
    }
    armFocusedRecording();
}

function handleRecordButtonPress() {
    if (isRecordTransitionPending()) {
        showStatus('REC busy...', 50);
        return;
    }
    if (s.view !== 'main') {
        showStatus('Close browser to record', 80);
        return;
    }
    if (s.recording) {
        if (s.shiftHeld) {
            stopFocusedRecording(true);
            showStatus('Rec stop+load ' + recordTargetLabel(), 90);
        } else {
            stopFocusedRecording(false);
            showStatus('Rec stop', 80);
        }
        return;
    }
    if (s.recordArmed && s.shiftHeld) {
        disarmFocusedRecording();
        return;
    }
    if (s.recordArmed) {
        startFocusedRecording();
        return;
    }
    armFocusedRecording();
}

function pollRecordingState() {
    const rec = clampInt(gp('recording', s.recording), 0, 1, s.recording);
    if (rec === s.recording) {
        pollPendingRecordedPath();
        return;
    }

    const prev = s.recording;
    s.recording = rec;

    if (prev === 1 && rec === 0) {
        const pathRaw = latestRecordedPathCandidate();
        const shouldLoad = !!s.recordLoadOnStop;
        const t = copyRecordTarget(s.recTargetLocked || s.recTarget);
        s.recordLoadOnStop = false;
        s.recordArmed = false;
        setRecordState('idle');
        s.recordBlinkOn = false;
        s.recordBlinkTicks = 0;
        setRecordMonitorEnabled(false);

        if (pathRaw) {
            clearPendingRecordedPath();
            finishRecordedPath(pathRaw, shouldLoad, t);
        } else {
            queuePendingRecordedPath(shouldLoad, t);
            showStatus('Finalizing recording...', 80);
            saveAutosaveSession(true);
        }
    } else if (rec === 1) {
        clearPendingRecordedPath();
        s.recordArmed = true;
        setRecordState('recording');
        s.recordBlinkOn = true;
        s.recordBlinkTicks = 0;
        setRecordMonitorEnabled(true);
        showStatus('Recording...', 80);
    }

    s.dirty = true;
    updateRecordButtonLed();
}

function tickRecordStateMachine() {
    if (s.recordState !== 'starting' && s.recordState !== 'stopping') return;
    s.recordStateTicks++;
    if (s.recordStateTicks < RECORD_ACK_TIMEOUT_TICKS) return;
    if (s.recordState === 'starting') {
        setRecordState('armed');
        showStatus('REC start timeout', 80);
    } else if (s.recordState === 'stopping') {
        setRecordState(s.recording ? 'recording' : 'idle');
        showStatus('REC stop timeout', 80);
    }
}

function updateRecordButtonLed() {
    const color = s.recording
        ? BrightRed
        : (s.recordArmed ? (s.recordBlinkOn ? BrightRed : Black) : Black);
    setButtonLED(MoveRec, color);
    setButtonLED(MoveRecord, color);
}

function loopLedColor() {
    const st = currentLooper().state;
    if (st === 'recording') return BrightRed;
    if (st === 'overdub') return LOOP_PAD_COLOR_OVERDUB;
    if (st === 'playing') return LOOP_PAD_COLOR_PLAY;
    if (st === 'stopped') return LOOP_PAD_COLOR_STOPPED;
    return Black;
}

function updateUtilityButtonLeds() {
    setButtonLED(MoveLoop, loopLedColor());
    setButtonLED(MoveMute, s.muteHeld ? 120 : Black);
    const looperState = currentLooper().state;
    const playColor = (looperState === 'playing' || looperState === 'overdub') ? 21 : (looperState === 'stopped' ? 118 : Black);
    setButtonLED(MovePlay, playColor);
    let fxOn = 0;
    for (let i = 0; i < FX_EFFECT_COUNT; i++) {
        if (globalFxEffect(i).enabled) fxOn++;
    }
    for (let sec = 0; sec < GRID_COUNT; sec++) {
        const bank = s.sections[sec].currentBank;
        for (let i = 0; i < FX_EFFECT_COUNT; i++) {
            if (bankFxEffect(sec, bank, i).enabled) fxOn++;
        }
    }
    setButtonLED(MoveArrowUp, s.view === 'fx' ? 120 : (fxOn > 0 ? 21 : Black));
    setButtonLED(MoveArrowDown, s.view === 'fx' ? 21 : Black);
}

function tickRecordButtonBlink() {
    if (s.recording || !s.recordArmed) return;
    s.recordBlinkTicks++;
    if (s.recordBlinkTicks < RECORD_LED_BLINK_PERIOD_TICKS) return;
    s.recordBlinkTicks = 0;
    s.recordBlinkOn = !s.recordBlinkOn;
    updateRecordButtonLed();
}

function currentEffectivePath() {
    const sec = s.focusedSection;
    const bank = focusedBank(sec);
    const slot = focusedSlot();
    if (s.sections[sec].mode === MODE_SINGLE) return bank.sourcePath;
    return slot.path || bank.sourcePath;
}

function drawMain() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    const sl = focusedSlot();
    const fb = focusedBank();
    const chops = normalizeChopCount(fb.chopCount);
    const trans = normalizeTransientSensitivity(fb.transientSensitivity);

    const lMode = s.sections[0].mode === MODE_SINGLE ? 'SRC' : 'PAD';
    const rMode = s.sections[1].mode === MODE_SINGLE ? 'SRC' : 'PAD';
    const looperState = currentLooper().state;
    const looperTag = looperState === 'recording'
        ? 'REC'
        : (looperState === 'overdub'
            ? 'OVD'
            : (looperState === 'playing'
                ? 'PLAY'
                : (looperState === 'stopped' ? 'STOP' : 'OFF')));

    clear_screen();

    const recTag = s.recording ? ' REC' : (s.recordArmed ? ' ARM' : '');
    const title = 'TwinSampler' + (MODULE_FLAVOR ? (' ' + MODULE_FLAVOR) : '') + recTag;
    print(0, 0, shortText(title, 21), 1);
    print(0, 10, shortText('L:' + lMode + ' B' + (s.sections[0].currentBank + 1) + '  R:' + rMode + ' B' + (s.sections[1].currentBank + 1), 21), 1);
    print(0, 20, shortText('F:S' + (sec + 1) + 'B' + (bank + 1) + 'P' + (slot + 1) + ' C' + chops + ' T' + trans, 21), 1);
    print(0, 30, shortText((s.sections[sec].mode === MODE_SINGLE ? 'Src: ' : 'Smp: ') + (baseName(currentEffectivePath()) || '--'), 21), 1);

    if (s.knobPage === 'A') {
        if (s.editScope === 'P') {
            print(0, 40, shortText('A:' + Math.round(sl.attack) + ' D:' + Math.round(sl.decay) + ' S:' + Math.round(sl.startTrim) + ' E:' + Math.round(sl.endTrim), 21), 1);
        } else {
            print(0, 40, shortText('ALL: Atk/Dec/Trim', 21), 1);
        }
    } else {
        if (s.editScope === 'P') {
            const modeTxt = sl.modeGate ? 'Gate' : 'Trig';
            print(0, 40, shortText('M:' + modeTxt + ' P:' + sl.pitch.toFixed(1) + ' G:' + sl.gain.toFixed(2) + ' Pan:' + sl.pan.toFixed(2), 21), 1);
        } else {
            print(0, 40, shortText('Pitch:' + s.globalPitch.toFixed(1) + ' Gain:' + s.globalGain.toFixed(2) + ' Vel:' + (s.velocitySens ? 'On' : 'Off'), 21), 1);
        }
    }

    let footer = '';
    if (s.statusTicks > 0) footer = s.statusText;
    else if (s.recording || s.recordState === 'starting' || s.recordState === 'stopping') {
        footer = 'REC->' + recordTargetLabel() + ' ' + s.recordState.toUpperCase();
    } else if (s.copySource) footer = 'Copy armed: tap dest pad';
    else footer = 'Loop' + (s.activeLooper + 1) + ':' + looperTag + ' M:' + (s.muteHeld ? 'ON' : 'OFF');
    print(0, 50, shortText(footer, 21), 1);
}

function drawBrowser() {
    clear_screen();

    const modeLabel = s.browserMode === 'sessions'
        ? ('Sessions ' + (s.sessionBrowserIntent === 'save' ? 'SAVE' : 'LOAD'))
        : 'Samples';
    print(0, 0, shortText(modeLabel + ' ' + baseName(s.browserPath), 21), 1);

    const visible = s.browserEntries.slice(s.browserScroll, s.browserScroll + 4);
    for (let i = 0; i < 4; i++) {
        const e = visible[i];
        if (!e) continue;
        const idx = s.browserScroll + i;
        const prefix = idx === s.browserCursor ? '>' : ' ';
        const row = prefix + (e.dir ? '/' : ' ') + e.name;
        print(0, 10 + i * 10, shortText(row, 21), idx === s.browserCursor ? 2 : 1);
    }

    if (!s.browserEntries.length) {
        print(0, 20, s.browserMode === 'sessions' ? 'No sessions' : 'No WAV files', 1);
    }

    if (s.browserMode === 'sessions') {
        const idx = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
        const action = s.sessionBrowserIntent === 'save' ? 'Save' : 'Load';
        print(0, 50, shortText(action + ' N:' + s.sessionName + ' i' + (idx + 1), 21), 1);
    } else {
        const tgt = s.browserAssignMode === 'auto' ? 'AUTO' : (s.browserAssignMode === 'slot' ? 'SLOT' : 'SRC');
        print(0, 50, shortText('Target:' + tgt + ' Menu=cycle', 21), 1);
    }
}

function drawFxScreen() {
    clear_screen();
    print(0, 0, shortText('FX Screen  L=Bank R=Global', 21), 1);
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    print(0, 10, shortText('Bank S' + (sec + 1) + 'B' + (bank + 1) + ' FX :' + (s.selectedBankFxEffect + 1), 21), 1);
    print(0, 20, shortText('Global FX :' + (s.selectedGlobalFxEffect + 1), 21), 1);
    const scope = s.fxScreenScope === 'global' ? 'GLOBAL' : 'BANK';
    const scopeKey = s.fxScreenScope === 'global' ? 'global' : 'bank';
    const effectIdx = s.fxScreenScope === 'global' ? s.selectedGlobalFxEffect : s.selectedBankFxEffect;
    const eff = s.fxScreenScope === 'global' ? globalFxEffect(effectIdx) : bankFxEffect(sec, bank, effectIdx);
    const name = fxSlotName(scopeKey, effectIdx);
    print(0, 30, shortText(name + ' ' + scope + ' ' + (eff.enabled ? 'ON' : 'OFF'), 21), 1);
    const p = Array.isArray(eff.params) ? eff.params : [];
    const rowA = [0, 1, 2, 3].map((i) => fxParamCompactToken(scopeKey, effectIdx, i, p[i])).join(' ');
    const rowB = [4, 5, 6, 7].map((i) => fxParamCompactToken(scopeKey, effectIdx, i, p[i])).join(' ');
    print(0, 40, rowA, 1);
    const footer = (s.statusTicks > 0) ? s.statusText : rowB;
    print(0, 50, shortText(footer, 21), 1);
}

function draw() {
    if (s.view === 'browser') {
        drawBrowser();
    } else if (s.view === 'fx') {
        drawFxScreen();
    } else {
        drawMain();
    }
}

function serializeSession() {
    return {
        version: 5,
        sessionName: s.sessionName,
        selectedSlice: s.selectedSlice,
        focusedSection: s.focusedSection,
        knobPage: s.knobPage,
        editScope: s.editScope,
        browserAssignMode: s.browserAssignMode,
        fxScreenScope: s.fxScreenScope,
        selectedBankFxEffect: clampInt(s.selectedBankFxEffect, 0, FX_EFFECT_COUNT - 1, 0),
        selectedGlobalFxEffect: clampInt(s.selectedGlobalFxEffect, 0, FX_EFFECT_COUNT - 1, 0),
        globalGain: s.globalGain,
        globalPitch: s.globalPitch,
        velocitySens: s.velocitySens,
        globalFxEffects: Array.from({ length: FX_EFFECT_COUNT }, (_, idx) => {
            const eff = globalFxEffect(idx);
            return {
                enabled: clampInt(eff.enabled, 0, 1, 0),
                params: Array.from({ length: FX_PARAM_COUNT }, (_p, pIdx) => clampFloat(Array.isArray(eff.params) ? eff.params[pIdx] : 0.5, 0.0, 1.0, 0.5))
            };
        }),
        recordMaxSeconds: s.recordMaxSeconds,
        activeLooper: clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0),
        loopPadMode: !!s.loopPadMode,
        loopPadPage: clampInt(s.loopPadPage, 0, Math.max(0, Math.floor((s.midiLoopers.length - 1) / LOOPER_PAGE_SIZE)), 0),
        loopPadSection: clampInt(s.loopPadSection, 0, GRID_COUNT - 1, 1),
        loopPadFullGrid: !!s.loopPadFullGrid,
        midiLoopers: s.midiLoopers.map((l) => ({
            state: (l && (l.state === 'playing' || l.state === 'stopped' || l.state === 'empty')) ? l.state : (l && l.events && l.events.length ? 'stopped' : 'empty'),
            quantized: (l && l.quantized) ? 1 : 0,
            loopLengthMs: clampInt(l && l.loopLengthMs, 0, 600000, 0),
            events: Array.isArray(l && l.events)
                ? l.events.map((ev) => ({
                    atMs: clampInt(ev && ev.atMs, 0, 600000, 0),
                    type: (ev && ev.type === 'off') ? 'off' : 'on',
                    sec: clampInt(ev && ev.sec, 0, GRID_COUNT - 1, 0),
                    bank: clampInt(ev && ev.bank, 0, BANK_COUNT - 1, 0),
                    slot: clampInt(ev && ev.slot, 0, GRID_SIZE - 1, 0),
                    velocity: clampInt(ev && ev.velocity, 0, 127, 0)
                }))
                : [],
            preQuantizeEvents: Array.isArray(l && l.preQuantizeEvents)
                ? l.preQuantizeEvents.map((ev) => ({
                    atMs: clampInt(ev && ev.atMs, 0, 600000, 0),
                    type: (ev && ev.type === 'off') ? 'off' : 'on',
                    sec: clampInt(ev && ev.sec, 0, GRID_COUNT - 1, 0),
                    bank: clampInt(ev && ev.bank, 0, BANK_COUNT - 1, 0),
                    slot: clampInt(ev && ev.slot, 0, GRID_SIZE - 1, 0),
                    velocity: clampInt(ev && ev.velocity, 0, 127, 0)
                }))
                : []
        })),
        sections: s.sections.map((sec) => ({
            mode: sec.mode,
            currentBank: sec.currentBank,
            banks: sec.banks.map((bank) => cloneBank(bank))
        }))
    };
}

function sanitizeSlot(raw) {
    const base = makeSlot();
    if (!raw || typeof raw !== 'object') return base;

    return {
        path: typeof raw.path === 'string' ? raw.path : '',
        attack: clampFloat(raw.attack, 1.0, 5000.0, base.attack),
        decay: clampFloat(raw.decay, 1.0, DECAY_MAX_MS, base.decay),
        startTrim: clampFloat(raw.startTrim, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, base.startTrim),
        endTrim: clampFloat(raw.endTrim, SLOT_TRIM_MIN_MS, SLOT_TRIM_MAX_MS, base.endTrim),
        gain: clampFloat(raw.gain, 0.0, 4.0, base.gain),
        pan: clampFloat(raw.pan, -1.0, 1.0, base.pan),
        pitch: clampFloat(raw.pitch, -48.0, 48.0, base.pitch),
        modeGate: clampInt(raw.modeGate, 0, 1, base.modeGate),
        loop: clampInt(raw.loop, 0, 2, base.loop),
        reverse: clampInt(raw.reverse, 0, 1, base.reverse),
        color: clampInt(raw.color, -1, 127, base.color),
        muted: clampInt(raw.muted, 0, 1, base.muted)
    };
}

function sanitizeBank(raw, bankIdx) {
    const base = makeBank(bankIdx);
    if (!raw || typeof raw !== 'object') return base;

    const chopCount = normalizeChopCount(raw.chopCount);
    const maxPages = Math.max(1, Math.floor(chopCount / GRID_SIZE));

    const out = {
        sourcePath: typeof raw.sourcePath === 'string' ? raw.sourcePath : '',
        bankColor: normalizeColor(raw.bankColor, base.bankColor),
        chopCount,
        slicePage: clampInt(raw.slicePage, 0, maxPages - 1, 0),
        transientSensitivity: normalizeTransientSensitivity(raw.transientSensitivity),
        sliceStarts: parseSliceStartsString(Array.isArray(raw.sliceStarts) ? raw.sliceStarts.join(',') : raw.sliceStarts, chopCount),
        filterType: clampInt(raw.filterType, 0, FILTER_TYPES.length - 1, base.filterType),
        filterValue: clampFloat(raw.filterValue, 0.0, 1.0, base.filterValue),
        emulationPreset: clampInt(raw.emulationPreset, 0, EMULATION_PRESETS.length - 1, base.emulationPreset),
        fxEffects: Array.from({ length: FX_EFFECT_COUNT }, (_eff, effIdx) => {
            const src = fxSourceEntry(raw.fxEffects, effIdx, 'bank');
            return {
                enabled: clampInt(src && src.enabled, 0, 1, 0),
                params: Array.from(
                    { length: FX_PARAM_COUNT },
                    (_p, pIdx) => normalizeFxParam(effIdx, pIdx, src && Array.isArray(src.params) ? src.params[pIdx] : defaultFxParam(effIdx, pIdx, 'bank'), defaultFxParam(effIdx, pIdx, 'bank'))
                )
            };
        }),
        slots: []
    };

    for (let i = 0; i < GRID_SIZE; i++) {
        const rs = Array.isArray(raw.slots) ? raw.slots[i] : null;
        out.slots.push(sanitizeSlot(rs));
    }
    return out;
}

function sanitizeSection(raw, defaultMode) {
    const base = makeSection(defaultMode);
    if (!raw || typeof raw !== 'object') return base;

    return {
        mode: clampInt(raw.mode, 0, 1, base.mode),
        currentBank: clampInt(raw.currentBank, 0, BANK_COUNT - 1, base.currentBank),
        banks: Array.from({ length: BANK_COUNT }, (_, i) => sanitizeBank(Array.isArray(raw.banks) ? raw.banks[i] : null, i))
    };
}

function sanitizeLooperState(raw) {
    const base = createLooperState();
    if (!raw || typeof raw !== 'object') return base;

    const len = clampInt(raw.loopLengthMs, 0, 600000, 0);
    const srcEvents = Array.isArray(raw.events) ? raw.events : [];
    const srcPreQuantizeEvents = Array.isArray(raw.preQuantizeEvents) ? raw.preQuantizeEvents : [];
    const events = srcEvents
        .map((ev) => ({
            atMs: clampInt(ev && ev.atMs, 0, Math.max(0, len - 1), 0),
            type: (ev && ev.type === 'off') ? 'off' : 'on',
            sec: clampInt(ev && ev.sec, 0, GRID_COUNT - 1, 0),
            bank: clampInt(ev && ev.bank, 0, BANK_COUNT - 1, 0),
            slot: clampInt(ev && ev.slot, 0, GRID_SIZE - 1, 0),
            velocity: clampInt(ev && ev.velocity, 0, 127, 0)
        }))
        .sort((a, b) => a.atMs - b.atMs);
    const preQuantizeEvents = srcPreQuantizeEvents
        .map((ev) => ({
            atMs: clampInt(ev && ev.atMs, 0, Math.max(0, len - 1), 0),
            type: (ev && ev.type === 'off') ? 'off' : 'on',
            sec: clampInt(ev && ev.sec, 0, GRID_COUNT - 1, 0),
            bank: clampInt(ev && ev.bank, 0, BANK_COUNT - 1, 0),
            slot: clampInt(ev && ev.slot, 0, GRID_SIZE - 1, 0),
            velocity: clampInt(ev && ev.velocity, 0, 127, 0)
        }))
        .sort((a, b) => a.atMs - b.atMs);

    let state = 'empty';
    if (events.length && len > 0) {
        const inState = String(raw.state || '').toLowerCase();
        if (inState === 'playing' || inState === 'stopped') state = inState;
        else state = 'stopped';
    }

    return {
        state,
        events,
        quantized: (raw.quantized && preQuantizeEvents.length) ? 1 : 0,
        preQuantizeEvents: (raw.quantized && preQuantizeEvents.length) ? preQuantizeEvents : [],
        loopLengthMs: events.length ? len : 0,
        recordStartMs: 0,
        playStartMs: looperNowMs(),
        loopPosMs: 0,
        lastLoopPosMs: 0,
        layerStack: [],
        buttonHeld: false,
        buttonDownTick: -1,
        lastPressTick: -9999,
        eraseHoldTriggered: false,
        holdEraseArmed: false
    };
}

function applyAllStateToDsp() {
    resetEditCursorCache();
    sp('global_gain', s.globalGain.toFixed(3));
    sp('global_pitch', s.globalPitch.toFixed(2));
    sp('velocity_sens', String(s.velocitySens));
    sp('record_max_seconds', String(s.recordMaxSeconds));

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        spb('section_mode', sec + ':' + s.sections[sec].mode, 200);
    }

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        for (let bank = 0; bank < BANK_COUNT; bank++) {
            applyBankStateToDsp(sec, bank, true, true);
        }
    }

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        const bank = s.sections[sec].currentBank;
        spb('section_bank', sec + ':' + bank, 200);
    }
    for (let fx = 0; fx < FX_EFFECT_COUNT; fx++) sendFxStateToDsp('global', 0, 0, fx);
    sendHiddenFxOffToDsp();
    /* Extra blocking FX sync to prevent stale audible FX state on auto-restored sessions. */
    for (let fx = 0; fx < FX_EFFECT_COUNT; fx++) {
        const dspFx = fxDspIndex(fx, 'global');
        const ge = globalFxEffect(fx);
        spb('performance_fx_global_toggle', dspFx + ':' + clampInt(ge && ge.enabled, 0, 1, 0), 180);
        spb('pfx_global_toggle', dspFx + ':' + clampInt(ge && ge.enabled, 0, 1, 0), 180);
        for (let sec = 0; sec < GRID_COUNT; sec++) {
            for (let bank = 0; bank < BANK_COUNT; bank++) {
                const be = bankFxEffect(sec, bank, fx);
                const en = clampInt(be && be.enabled, 0, 1, 0);
                const payload = sec + ':' + bank + ':' + dspFx + ':' + en;
                spb('performance_fx_bank_toggle', payload, 180);
                spb('pfx_bank_toggle', payload, 180);
            }
        }
    }

    setSelectedSlice(s.selectedSlice);
    markLedsDirty();
}

function applyParsedSession(parsed, silent, label) {
    if (!parsed || typeof parsed !== 'object') {
        if (!silent) showStatus('Session invalid', 120);
        return false;
    }

    s.sessionName = sanitizeSessionName(parsed.sessionName || s.sessionName);
    s.selectedSlice = clampInt(parsed.selectedSlice, 0, TOTAL_PADS - 1, 0);
    if (LEFT_GRID_ONLY) s.selectedSlice = slotFromSlice(s.selectedSlice);
    s.focusedSection = LEFT_GRID_ONLY ? 0 : sectionFromSlice(s.selectedSlice);
    s.knobPage = parsed.knobPage === 'B' ? 'B' : 'A';
    s.editScope = parsed.editScope === 'G' ? 'G' : 'P';
    s.fxScreenScope = parsed.fxScreenScope === 'global' ? 'global' : 'bank';
    s.selectedBankFxEffect = clampInt(parsed.selectedBankFxEffect, 0, FX_EFFECT_COUNT - 1, 0);
    s.selectedGlobalFxEffect = clampInt(parsed.selectedGlobalFxEffect, 0, FX_EFFECT_COUNT - 1, 0);
    s.browserAssignMode = parsed.browserAssignMode === 'slot' || parsed.browserAssignMode === 'source' ? parsed.browserAssignMode : 'auto';

    s.globalGain = clampFloat(parsed.globalGain, 0.0, 4.0, 1.0);
    s.globalPitch = clampFloat(parsed.globalPitch, -48.0, 48.0, 0.0);
    s.velocitySens = clampInt(parsed.velocitySens, 0, 1, 0);
    s.globalFxEffects = Array.from({ length: FX_EFFECT_COUNT }, (_, idx) => {
        const src = fxSourceEntry(parsed.globalFxEffects, idx, 'global');
        return {
            enabled: clampInt(src && src.enabled, 0, 1, 0),
            params: Array.from(
                { length: FX_PARAM_COUNT },
                (_p, pIdx) => normalizeFxParam(idx, pIdx, src && Array.isArray(src.params) ? src.params[pIdx] : defaultFxParam(idx, pIdx, 'global'), defaultFxParam(idx, pIdx, 'global'))
            )
        };
    });
    s.recordMaxSeconds = clampInt(parsed.recordMaxSeconds, 1, 600, 30);
    const rawLoopers = Array.isArray(parsed.midiLoopers) ? parsed.midiLoopers : [];
    s.midiLoopers = Array.from({ length: LOOPER_COUNT }, (_, i) => sanitizeLooperState(rawLoopers[i]));
    s.activeLooper = clampInt(parsed.activeLooper, 0, s.midiLoopers.length - 1, 0);
    s.loopPadMode = !!parsed.loopPadMode;
    s.loopPadPage = clampInt(parsed.loopPadPage, 0, Math.max(0, Math.floor((s.midiLoopers.length - 1) / LOOPER_PAGE_SIZE)), 0);
    s.loopPadSection = clampInt(parsed.loopPadSection, 0, GRID_COUNT - 1, 1);
    s.loopPadFullGrid = !!parsed.loopPadFullGrid;

    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
    s.sections = [
        sanitizeSection(rawSections[0], MODE_SINGLE),
        sanitizeSection(rawSections[1], MODE_PER_SLOT)
    ];

    invalidatePlaybackCompat();
    applyAllStateToDsp();
    scheduleFocusedSlotRefresh();
    scheduleTrimReplayAll();
    for (let sec = 0; sec < GRID_COUNT; sec++) {
        for (let bank = 0; bank < BANK_COUNT; bank++) syncBankSliceState(sec, bank);
    }
    updateUtilityButtonLeds();
    markLedsDirty();
    s.autosavePending = false;
    s.autosaveTicks = 0;
    if (!silent) showStatus('Loaded ' + shortText(label || s.sessionName, 14), 120);
    s.dirty = true;
    return true;
}

function loadSessionFromPath(path, silent, trackHistory = true) {
    const text = readTextFile(path);
    if (!text) {
        if (!silent) showStatus('Session not found', 120);
        return false;
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        if (!silent) showStatus('Session parse failed', 120);
        return false;
    }

    if (!parsed || typeof parsed !== 'object') {
        if (!silent) showStatus('Session invalid', 120);
        return false;
    }

    const ok = applyParsedSession(parsed, silent, sessionNameFromPath(path));
    if (ok && trackHistory) noteHistoryChanged();
    return ok;
}

function saveSessionToPath(path, label, silent, refreshBrowser) {
    const ok = writeTextFile(path, JSON.stringify(serializeSession(), null, 2) + '\n');
    if (ok) {
        s.autosavePending = false;
        s.autosaveTicks = 0;
        if (refreshBrowser && s.browserMode === 'sessions') refreshBrowserList();
    }
    if (!silent) showStatus(ok ? ('Saved ' + label) : 'Session save failed', 120);
    return ok;
}

function saveSessionNamed(silent) {
    s.sessionName = sanitizeSessionName(s.sessionName);
    if (s.sessionName === INIT_SESSION_NAME) {
        s.sessionName = nextAutoSessionName();
        if (!silent) showStatus('INIT reserved -> ' + s.sessionName, 110);
    }
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    if (!ensureDirRecursive(SESSIONS_DIR)) {
        if (!silent) showStatus('Session dir failed', 120);
        return false;
    }

    return saveSessionToPath(sessionPathFromName(s.sessionName), s.sessionName, !!silent, true);
}

function saveAutosaveSession(force) {
    if (!force && !s.autosavePending) return true;
    const dirOk = ensureDirRecursive('/data/UserData/UserLibrary');
    if (!dirOk) return false;
    return saveSessionToPath(autosavePath(), 'AUTOSAVE', true, false);
}

function loadLegacySession(silent) {
    const legacy = readTextFile(LEGACY_SESSION_FILE);
    if (!legacy) return false;
    try {
        const parsed = JSON.parse(legacy);
        return applyParsedSession(parsed, silent, 'legacy');
    } catch (e) {
        return false;
    }
}

function setSessionNameFromSelected() {
    if (s.browserMode !== 'sessions') return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir) return;
    s.sessionName = sessionNameFromPath(e.path);
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    showStatus('Name <- ' + s.sessionName, 90);
    s.dirty = true;
}

function copySelectedSessionToAutoName() {
    if (s.browserMode !== 'sessions') return false;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir) {
        showStatus('Select session', 90);
        return false;
    }

    if (!ensureDirRecursive(SESSIONS_DIR)) {
        showStatus('Session dir failed', 120);
        return false;
    }

    const nextName = nextAutoSessionName();
    const dst = sessionPathFromName(nextName);

    let text = readTextFile(e.path);
    if (!text) {
        showStatus('Copy failed', 120);
        return false;
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            parsed.sessionName = nextName;
            text = JSON.stringify(parsed, null, 2) + '\n';
        }
    } catch (err) {}

    const ok = writeTextFile(dst, text);
    if (!ok) {
        showStatus('Copy failed', 120);
        return false;
    }

    s.sessionName = nextName;
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    refreshBrowserList();
    selectSessionEntryByName(nextName);
    showStatus('Copied as ' + nextName, 100);
    s.dirty = true;
    return true;
}

function renameSelectedSessionToCurrentName() {
    if (s.browserMode !== 'sessions') return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir) return;
    const currentName = sessionNameFromPath(e.path);
    if (currentName === INIT_SESSION_NAME) {
        showStatus('INIT locked', 100);
        return;
    }

    const nextName = sanitizeSessionName(s.sessionName);
    if (nextName === INIT_SESSION_NAME) {
        showStatus('INIT reserved', 100);
        return;
    }
    const dst = sessionPathFromName(nextName);
    if (dst === e.path) {
        showStatus('Same name', 70);
        return;
    }
    if (sessionNameExistsInEntries(nextName)) {
        showStatus('Name exists', 100);
        return;
    }
    const ok = renameFilePath(e.path, dst);
    if (!ok) {
        showStatus('Rename failed', 120);
        return;
    }

    s.sessionName = nextName;
    refreshBrowserList();
    showStatus('Renamed ' + nextName, 100);
    s.dirty = true;
}

function deleteSelectedSession() {
    if (s.browserMode !== 'sessions') return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir) return;
    if (sessionNameFromPath(e.path) === INIT_SESSION_NAME) {
        showStatus('INIT locked', 100);
        return;
    }

    const ok = deleteFilePath(e.path);
    if (!ok) {
        showStatus('Delete failed', 120);
        return;
    }

    refreshBrowserList();
    showStatus('Deleted ' + e.name, 100);
    s.dirty = true;
}

function deleteSelectedSampleFile() {
    if (s.browserMode !== 'samples') return;
    const e = s.browserEntries[s.browserCursor];
    if (!e || e.dir || !e.path || !/\.wav$/i.test(String(e.path))) {
        showStatus('Select WAV to delete', 100);
        return;
    }

    const ok = deleteFilePath(e.path);
    if (!ok) {
        showStatus('Delete failed', 120);
        return;
    }

    refreshBrowserList();
    previewStop();
    showStatus('Deleted ' + e.name, 100);
    s.dirty = true;
}

function adjustSessionNameIndex(delta) {
    if (delta === 0) return;
    s.sessionName = sanitizeSessionName(s.sessionName);
    const maxIdx = Math.max(0, s.sessionName.length - 1);
    s.sessionCharIndex = clampInt(s.sessionCharIndex + (delta > 0 ? 1 : -1), 0, maxIdx, 0);
    s.dirty = true;
}

function adjustSessionNameChar(delta) {
    if (delta === 0) return;
    const base = sanitizeSessionName(s.sessionName);
    const chars = base.split('');
    const idx = clampInt(s.sessionCharIndex, 0, SESSION_NAME_MAX - 1, 0);
    while (chars.length <= idx) chars.push('A');

    const cur = chars[idx];
    let pos = SESSION_CHARS.indexOf(cur);
    if (pos < 0) pos = 0;
    pos = clampInt(pos + (delta > 0 ? 1 : -1), 0, SESSION_CHARS.length - 1, pos);
    chars[idx] = SESSION_CHARS[pos];

    s.sessionName = sanitizeSessionName(chars.join(''));
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    showStatus('Name ' + s.sessionName, 60);
    s.dirty = true;
}

function cycleAssignMode() {
    if (s.browserMode !== 'samples') return;
    if (s.browserAssignMode === 'auto') s.browserAssignMode = 'slot';
    else if (s.browserAssignMode === 'slot') s.browserAssignMode = 'source';
    else s.browserAssignMode = 'auto';

    showStatus('Assign: ' + s.browserAssignMode.toUpperCase(), 80);
    markSessionChanged();
    s.dirty = true;
}

function handleMainButtonPress() {
    if (s.shiftHeld && s.volumeTouchHeld) {
        openSessionBrowser('load', false);
        return;
    }

    if (s.shiftHeld) {
        if (s.view === 'browser') {
            previewStop();
            s.view = 'main';
            showStatus('Browser closed', 60);
            s.dirty = true;
            return;
        }
        showStatus('Use Rec button', 60);
        return;
    }

    if (s.view === 'browser') {
        browserSelect();
        return;
    }

    s.view = 'browser';
    const samplePath = (s.browserMode === 'samples') ? (s.browserPath || SAMPLES_DIR) : SAMPLES_DIR;
    browserOpen(samplePath, 'samples');
    s.dirty = true;
}

function knobTouchActionLabel(note) {
    const idx = clampInt(note, 0, 7, 0);

    if (s.view === 'browser') {
        if (s.browserMode === 'sessions') {
            if (idx === 0) return 'Session name index';
            if (idx === 1) return 'Session name char';
            return 'No action';
        }
        return 'No action';
    }

    if (s.view === 'fx') {
        const sec = s.focusedSection;
        const bank = focusedBankIndex(sec);
        const scope = s.fxScreenScope === 'global' ? 'global' : 'bank';
        const effectIdx = scope === 'global'
            ? clampInt(s.selectedGlobalFxEffect, 0, FX_EFFECT_COUNT - 1, 0)
            : clampInt(s.selectedBankFxEffect, 0, FX_EFFECT_COUNT - 1, 0);
        const eff = scope === 'global' ? globalFxEffect(effectIdx) : bankFxEffect(sec, bank, effectIdx);
        if (idx === 0) {
            const preset = fxPresetIndexFromValue(Array.isArray(eff.params) ? eff.params[idx] : defaultFxParam(effectIdx, idx, scope)) + 1;
            return (scope === 'global' ? 'Global' : 'Bank') + ' Preset ' + preset;
        }
        const value = Math.round(clampFloat(Array.isArray(eff.params) ? eff.params[idx] : defaultFxParam(effectIdx, idx, scope), 0.0, 1.0, defaultFxParam(effectIdx, idx, scope)) * 100);
        return (scope === 'global' ? 'Global' : 'Bank') + ' ' + fxParamName(scope, effectIdx, idx) + ' ' + value;
    }

    if (s.view !== 'main') return 'No action';

    if (s.shiftHeld && s.volumeTouchHeld) {
        if (idx === 2) return 'Pad pan';
        if (idx === 3) return 'All pan';
        if (idx === 4) return 'Edit scope';
        if (idx === 5) return 'Source -> banks';
        if (idx === 6) return 'Bank color';
        if (idx === 7) return 'Pad color';
        return 'No action';
    }

    if (s.shiftHeld && !s.volumeTouchHeld) {
        if (idx === 0) return 'All attack';
        if (idx === 1) return 'All decay';
        if (idx === 2) return 'All start trim';
        if (idx === 3) return 'All end trim';
        if (idx === 4) return 'All mode';
        if (idx === 5) return s.sections[s.focusedSection].mode === MODE_SINGLE ? 'Bank pitch' : 'Global pitch';
        if (idx === 6) return 'All gain';
        if (idx === 7) return 'All loop';
    }

    if (s.editScope === 'P') {
        if (idx === 0) return 'Pad attack';
        if (idx === 1) return 'Pad decay';
        if (idx === 2) return 'Pad start trim';
        if (idx === 3) return 'Pad end trim';
        if (idx === 4) return 'Pad mode';
        if (idx === 5) return 'Pad pitch';
        if (idx === 6) return 'Pad gain';
        if (idx === 7) return 'Pad loop';
    } else {
        if (idx === 0) return 'All attack';
        if (idx === 1) return 'All decay';
        if (idx === 2) return 'All start trim';
        if (idx === 3) return 'All end trim';
        if (idx === 4) return 'All mode';
        if (idx === 5) return 'Global pitch';
        if (idx === 6) return 'Global gain';
        if (idx === 7) return 'All loop';
    }

    return 'No action';
}

function handleKnobTouch(note, velocity) {
    if (note < 0 || note > 7 || velocity <= 0) return false;

    if (s.shiftHeld && s.volumeTouchHeld && note === 2) {
        s.startTrimSoundingEnabled = !s.startTrimSoundingEnabled;
        showStatus(s.startTrimSoundingEnabled ? 'Start trim sound ON' : 'Start trim sound OFF', 90);
        return true;
    }

    if (s.shiftHeld && !USE_STEP_BANKS && s.view === 'main') {
        setSectionBank(s.focusedSection, note);
        s.knobPage = note < 4 ? 'A' : 'B';
        showStatus('K' + (note + 1) + ' Bank ' + (note + 1), 60);
        return true;
    }

    if (s.view === 'fx') {
        s.knobPage = note < 4 ? 'A' : 'B';
        showStatus('K' + (note + 1) + ': ' + knobTouchActionLabel(note), 70);
        s.dirty = true;
        return true;
    }

    s.knobPage = note < 4 ? 'A' : 'B';
    showStatus('K' + (note + 1) + ': ' + knobTouchActionLabel(note), 60);
    s.dirty = true;
    return true;
}

function clearStepFxHold(restoreView) {
    const hold = s.stepFxHold;
    if (!hold) return;

    if (restoreView && hold.momentaryActive) {
        s.view = hold.prevView === 'fx' ? 'fx' : 'main';
        s.fxScreenScope = hold.prevFxScope === 'global' ? 'global' : 'bank';
        markLedsDirty();
        updateUtilityButtonLeds();
        s.dirty = true;
    }

    s.stepFxHold = null;
}

function armStepFxHold(note) {
    const stepNote = clampInt(note, STEP_NOTE_MIN, STEP_NOTE_MAX, -1);
    if (stepNote < 0) return;
    clearStepFxHold(true);
    s.stepFxHold = {
        note: stepNote,
        startedAtMs: Date.now(),
        momentaryActive: false,
        prevView: s.view,
        prevFxScope: s.fxScreenScope
    };
}

function handleStepBankRelease(note) {
    if (!USE_STEP_BANKS) return false;
    const t = stepTargetFromNote(note);
    if (!t) return false;
    if (s.stepFxHold && s.stepFxHold.note === note) clearStepFxHold(true);
    return true;
}

function tickStepFxHold() {
    const hold = s.stepFxHold;
    if (!hold || hold.momentaryActive) return;
    if (s.view !== 'main') {
        clearStepFxHold(false);
        return;
    }
    if ((Date.now() - clampMsTimestamp(hold.startedAtMs, 0)) <= STEP_FX_HOLD_THRESHOLD_MS) return;

    hold.momentaryActive = true;
    s.view = 'fx';
    s.fxScreenScope = 'bank';
    showStatus('FX hold', 50);
    markLedsDirty();
    updateUtilityButtonLeds();
    s.dirty = true;
}

function handleStepBankNote(note, velocity) {
    if (!USE_STEP_BANKS || velocity <= 0) return false;
    const t = stepTargetFromNote(note);
    if (!t) return false;
    if (LEFT_GRID_ONLY && t.sec !== 0) return true;

    /* In FX view, step buttons should never switch banks or affect FX states. */
    if (s.view === 'fx') {
        if (s.stepFxHold && s.stepFxHold.note !== note) return true;
        if (!s.stepFxHold) return true;
    }

    if (s.shiftHeld && s.volumeTouchHeld) {
        clearStepFxHold(true);
        const keepColor = s.sections[t.sec].banks[t.bank].bankColor;
        s.sections[t.sec].banks[t.bank] = makeBank(t.bank);
        s.sections[t.sec].banks[t.bank].bankColor = keepColor;
        applyBankStateToDsp(t.sec, t.bank, true);
        if (s.focusedSection === t.sec && focusedBankIndex(t.sec) === t.bank) {
            editCursorCache.bank = -1;
            ensureEditCursor();
        }
        showStatus('S' + (t.sec + 1) + ' bank ' + (t.bank + 1) + ' cleared', 100);
        markLedsDirty();
        markSessionChanged();
        s.dirty = true;
        return true;
    }

    if (s.shiftHeld) {
        clearStepFxHold(true);
        if (!s.stepCopySource) {
            s.stepCopySource = { sec: t.sec, bank: t.bank };
            showStatus('Bank copy src S' + (t.sec + 1) + 'B' + (t.bank + 1), 100);
            markLedsDirty();
            return true;
        }

        if (s.stepCopySource.sec === t.sec && s.stepCopySource.bank === t.bank) {
            showStatus('Select destination step', 80);
            return true;
        }

        const src = cloneBank(s.sections[s.stepCopySource.sec].banks[s.stepCopySource.bank]);
        s.sections[t.sec].banks[t.bank] = src;
        applyBankStateToDsp(t.sec, t.bank, true);
        if (s.focusedSection === t.sec && focusedBankIndex(t.sec) === t.bank) {
            editCursorCache.bank = -1;
            ensureEditCursor();
        }
        showStatus(
            'Copied S' + (s.stepCopySource.sec + 1) + 'B' + (s.stepCopySource.bank + 1) +
            ' -> S' + (t.sec + 1) + 'B' + (t.bank + 1),
            110
        );
        markLedsDirty();
        markSessionChanged();
        s.dirty = true;
        return true;
    }

    s.stepCopySource = null;
    if (t.sec === 0) setSectionBank(0, t.bank);
    else setSectionBank(1, t.bank);
    focusSectionForEditing(t.sec);
    if (!s.volumeTouchHeld && s.view === 'main') armStepFxHold(note);
    else clearStepFxHold(false);
    return true;
}

function looperReset(clearEvents) {
    const l = currentLooper();
    l.state = 'empty';
    if (clearEvents) l.events = [];
    l.quantized = 0;
    l.preQuantizeEvents = [];
    l.loopLengthMs = 0;
    l.recordStartMs = 0;
    l.playStartMs = 0;
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    l.layerStack = [];
    l.buttonHeld = false;
    l.buttonDownTick = -1;
    l.lastPressTick = -9999;
    l.eraseHoldTriggered = false;
    l.holdEraseArmed = false;
    updateUtilityButtonLeds();
}

function looperRecordEvent(type, sec, bank, slot, velocity) {
    const l = currentLooper();
    if (l.state !== 'recording' && l.state !== 'overdub') return;
    l.quantized = 0;
    l.preQuantizeEvents = [];
    let atMs = 0;
    const now = looperNowMs();
    if (l.state === 'recording') atMs = Math.max(0, now - l.recordStartMs);
    else atMs = clampInt(l.loopPosMs, 0, Math.max(0, l.loopLengthMs - 1), 0);
    l.events.push({
        atMs,
        type: type === 'off' ? 'off' : 'on',
        sec: clampInt(sec, 0, GRID_COUNT - 1, 0),
        bank: clampInt(bank, 0, BANK_COUNT - 1, 0),
        slot: clampInt(slot, 0, GRID_SIZE - 1, 0),
        velocity: clampInt(velocity, 0, 127, 0)
    });
}

function looperBeginRecording() {
    const l = currentLooper();
    releaseVoicesByOwner('looper:', looperNowMs());
    l.events = [];
    l.quantized = 0;
    l.preQuantizeEvents = [];
    l.layerStack = [];
    l.recordStartMs = looperNowMs();
    l.playStartMs = l.recordStartMs;
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    l.loopLengthMs = 0;
    l.state = 'recording';
    showStatus('Looper: recording', 100);
    updateUtilityButtonLeds();
}

function looperFinishRecordingStartPlayback() {
    const l = currentLooper();
    releaseVoicesByOwner('looper:', looperNowMs());
    const now = looperNowMs();
    const len = Math.max(80, now - l.recordStartMs);
    l.loopLengthMs = len;
    l.events = l.events.filter((e) => e.atMs >= 0 && e.atMs < len);
    l.quantized = 0;
    l.preQuantizeEvents = [];
    l.playStartMs = now;
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    l.state = l.events.length ? 'playing' : 'empty';
    showStatus(l.events.length ? ('Looper: play ' + len + 'ms') : 'Looper: empty', 100);
    markSessionChanged();
    updateUtilityButtonLeds();
}

function looperToggleOverdub() {
    const l = currentLooper();
    if (l.state === 'playing') {
        l.layerStack.push(l.events.length);
        l.state = 'overdub';
        showStatus('Looper: overdub', 90);
    } else if (l.state === 'overdub') {
        l.state = 'playing';
        showStatus('Looper: play', 90);
    }
    markSessionChanged();
    updateUtilityButtonLeds();
}

function looperStopPlayback() {
    const l = currentLooper();
    if (l.state === 'empty') {
        showStatus('Looper: empty', 70);
        return;
    }
    if (l.state === 'recording') looperFinishRecordingStartPlayback();
    releaseVoicesByOwner('looper:', looperNowMs());
    l.state = l.events.length ? 'stopped' : 'empty';
    l.playStartMs = looperNowMs();
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    showStatus('Looper: stopped', 80);
    markSessionChanged();
    updateUtilityButtonLeds();
}

function toggleActiveLooperClipPlayback() {
    const l = currentLooper();
    if (!l || !Array.isArray(l.events) || !l.events.length || l.loopLengthMs <= 0) {
        showStatus('Looper clip empty', 80);
        updateUtilityButtonLeds();
        return;
    }
    if (l.state === 'recording') {
        looperFinishRecordingStartPlayback();
        return;
    }
    if (l.state === 'playing' || l.state === 'overdub') {
        looperStopPlayback();
        return;
    }
    l.state = 'playing';
    l.playStartMs = looperNowMs();
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    showStatus('Looper clip: play', 80);
    markSessionChanged();
    updateUtilityButtonLeds();
}

function looperErase() {
    ensureValidActiveLooper();
    releaseVoicesByOwner('looper:', looperNowMs());
    looperReset(true);
    showStatus('Looper: erased', 100);
    markSessionChanged();
    updateUtilityButtonLeds();
}

function looperUndoLastLayer() {
    const l = currentLooper();
    if (!Array.isArray(l.layerStack) || !l.layerStack.length) {
        showStatus('Looper: no layer', 80);
        return false;
    }
    const start = clampInt(l.layerStack.pop(), 0, l.events.length, 0);
    l.events = l.events.slice(0, start);
    l.quantized = 0;
    l.preQuantizeEvents = [];
    showStatus('Looper: layer undo', 90);
    markSessionChanged();
    updateUtilityButtonLeds();
    return true;
}

function looperQuantize(index, steps = 16) {
    const l = looperByIndex(index);
    if (!l || !Array.isArray(l.events) || !l.events.length || l.loopLengthMs <= 0) {
        showStatus('Looper: nothing to quantize', 90);
        return false;
    }

    if (l.quantized && Array.isArray(l.preQuantizeEvents) && l.preQuantizeEvents.length) {
        l.events = l.preQuantizeEvents.map((ev) => Object.assign({}, ev));
        l.quantized = 0;
        l.preQuantizeEvents = [];
        showStatus('Looper ' + (clampInt(index, 0, s.midiLoopers.length - 1, 0) + 1) + ': unquantized', 100);
        markSessionChanged();
        s.dirty = true;
        return true;
    }

    l.preQuantizeEvents = l.events.map((ev) => Object.assign({}, ev));
    const safeSteps = clampInt(steps, 2, 64, 16);
    const gridMs = Math.max(1, l.loopLengthMs / safeSteps);
    const minNoteMs = Math.max(1, Math.floor(gridMs * 0.25));

    const quantized = l.events.map((ev, idxEv) => {
        const q = Math.round(clampFloat(ev.atMs, 0, Math.max(0, l.loopLengthMs - 1), 0) / gridMs) * gridMs;
        return Object.assign({}, ev, { atMs: clampInt(q, 0, Math.max(0, l.loopLengthMs - 1), 0), _idx: idxEv });
    });

    const lastOnByKey = {};
    for (let i = 0; i < quantized.length; i++) {
        const ev = quantized[i];
        const key = ev.sec + ':' + ev.bank + ':' + ev.slot;
        if (ev.type === 'on') {
            lastOnByKey[key] = ev.atMs;
        } else {
            const onAt = lastOnByKey[key];
            if (Number.isFinite(onAt) && ev.atMs <= onAt) {
                ev.atMs = clampInt(onAt + minNoteMs, 0, Math.max(0, l.loopLengthMs - 1), onAt);
            }
        }
    }

    quantized.sort((a, b) => {
        if (a.atMs !== b.atMs) return a.atMs - b.atMs;
        if (a.type !== b.type) return a.type === 'on' ? -1 : 1;
        return a._idx - b._idx;
    });
    for (let i = 0; i < quantized.length; i++) delete quantized[i]._idx;

    l.events = quantized;
    l.quantized = 1;
    showStatus('Looper ' + (clampInt(index, 0, s.midiLoopers.length - 1, 0) + 1) + ': quantized 1/' + safeSteps, 100);
    markSessionChanged();
    updateUtilityButtonLeds();
    s.dirty = true;
    return true;
}

function handleLoopButtonPress(fromPadTap = false) {
    const l = currentLooper();
    const now = s.transportTicks;
    const isDouble = !fromPadTap && ((now - l.lastPressTick) <= LOOP_DOUBLE_PRESS_TICKS);
    l.lastPressTick = now;
    l.buttonHeld = !fromPadTap;
    l.buttonDownTick = fromPadTap ? -1 : now;
    l.eraseHoldTriggered = false;
    l.holdEraseArmed = false;

    if (isDouble) {
        looperStopPlayback();
        l.holdEraseArmed = true;
        showStatus('Looper: stopped (hold to erase)', 100);
        return;
    }

    if (l.state === 'empty') {
        looperBeginRecording();
        return;
    }
    if (l.state === 'stopped') {
        l.state = 'playing';
        l.playStartMs = looperNowMs();
        l.loopPosMs = 0;
        l.lastLoopPosMs = 0;
        showStatus('Looper: play', 90);
        updateUtilityButtonLeds();
        return;
    }
    if (l.state === 'recording') {
        looperFinishRecordingStartPlayback();
        return;
    }
    looperToggleOverdub();
}

function handleLoopButtonRelease() {
    const l = currentLooper();
    l.buttonHeld = false;
    l.buttonDownTick = -1;
    l.holdEraseArmed = false;
}

function stopActiveLooperForSwitch() {
    const l = currentLooper();
    releaseVoicesByOwner('looper:' + String(clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0)), looperNowMs());
    if (l.state === 'recording') looperFinishRecordingStartPlayback();
    if (l.state === 'playing' || l.state === 'overdub') {
        l.state = 'stopped';
        l.buttonHeld = false;
        l.buttonDownTick = -1;
    }
}

function selectLooper(index) {
    const next = clampInt(index, 0, s.midiLoopers.length - 1, 0);
    if (next === s.activeLooper) return;
    stopActiveLooperForSwitch();
    s.activeLooper = next;
    updateUtilityButtonLeds();
    markLedsDirty();
}

function looperHasMaterial(index) {
    const l = looperByIndex(index);
    if (!l) return false;
    if (Array.isArray(l.events) && l.events.length > 0) return true;
    return l.state === 'recording' || l.state === 'playing' || l.state === 'overdub' || l.state === 'stopped';
}

function ensureValidActiveLooper() {
    if (looperHasMaterial(s.activeLooper)) return s.activeLooper;
    for (let i = 0; i < s.midiLoopers.length; i++) {
        if (!looperHasMaterial(i)) continue;
        if (i !== s.activeLooper) selectLooper(i);
        return i;
    }
    return s.activeLooper;
}

function cloneLooperState(index) {
    const l = looperByIndex(index);
    if (!l) return null;
    return {
        state: l.state,
        events: Array.isArray(l.events) ? l.events.map((ev) => Object.assign({}, ev)) : [],
        quantized: l.quantized ? 1 : 0,
        preQuantizeEvents: Array.isArray(l.preQuantizeEvents) ? l.preQuantizeEvents.map((ev) => Object.assign({}, ev)) : [],
        loopLengthMs: clampInt(l.loopLengthMs, 0, 600000, 0),
        layerStack: Array.isArray(l.layerStack) ? l.layerStack.slice() : []
    };
}

function applyClonedLooperState(index, cloned) {
    if (!cloned) return false;
    const l = looperByIndex(index);
    if (!l) return false;
    l.state = cloned.state;
    l.events = cloned.events.map((ev) => Object.assign({}, ev));
    l.quantized = cloned.quantized ? 1 : 0;
    l.preQuantizeEvents = (l.quantized && cloned.preQuantizeEvents.length)
        ? cloned.preQuantizeEvents.map((ev) => Object.assign({}, ev))
        : [];
    l.loopLengthMs = clampInt(cloned.loopLengthMs, 0, 600000, 0);
    l.recordStartMs = 0;
    l.playStartMs = looperNowMs();
    l.loopPosMs = 0;
    l.lastLoopPosMs = 0;
    l.layerStack = Array.isArray(cloned.layerStack) ? cloned.layerStack.slice() : [];
    l.buttonHeld = false;
    l.buttonDownTick = -1;
    l.lastPressTick = -9999;
    l.eraseHoldTriggered = false;
    l.holdEraseArmed = false;
    return true;
}

function copyActiveLooperTo(index) {
    const srcIdx = clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0);
    const dstIdx = clampInt(index, 0, s.midiLoopers.length - 1, 0);
    if (srcIdx === dstIdx) {
        showStatus('Select destination looper', 80);
        return true;
    }
    if (looperHasMaterial(dstIdx)) {
        showStatus('Looper ' + (dstIdx + 1) + ' not empty', 90);
        return true;
    }
    const cloned = cloneLooperState(srcIdx);
    if (!cloned || !cloned.events.length || cloned.loopLengthMs <= 0) {
        showStatus('Source looper empty', 90);
        return true;
    }
    if (applyClonedLooperState(dstIdx, cloned)) {
        showStatus('Loop ' + (srcIdx + 1) + ' -> ' + (dstIdx + 1), 100);
        markSessionChanged();
        markLedsDirty();
        return true;
    }
    return false;
}

function fireLooperPad(index) {
    const next = clampInt(index, 0, s.midiLoopers.length - 1, 0);
    if (s.deleteHeld) {
        eraseLooperAt(next);
        return;
    }
    if (s.copyHeld) {
        s.copyConsumed = true;
        copyActiveLooperTo(next);
        return;
    }
    if (next !== s.activeLooper) selectLooper(next);
    if (s.shiftHeld) {
        looperQuantize(next, 16);
        return;
    }
    handleLoopButtonPress(false);
}

function toggleLoopPadMode() {
    s.loopPadMode = !s.loopPadMode;
    if (s.loopPadMode) {
        s.loopPadPage = 0;
        s.loopPadSection = 1;
        s.loopPadFullGrid = false;
    }
    showStatus(s.loopPadMode ? 'Looper pad mode ON' : 'Looper pad mode OFF', 90);
    markLedsDirty();
    updateUtilityButtonLeds();
}

function shiftLooperPadWindow(delta) {
    if (!s.loopPadMode || delta === 0) return false;
    const dir = delta > 0 ? 1 : -1;
    const maxPage = Math.max(0, Math.floor((s.midiLoopers.length - 1) / LOOPER_PAGE_SIZE));
    let nextPage = clampInt(s.loopPadPage, 0, maxPage, 0);
    let nextSection = clampInt(s.loopPadSection, 0, GRID_COUNT - 1, 1);
    let nextFullGrid = !!s.loopPadFullGrid;

    if (nextFullGrid) {
        if (dir < 0) {
            /* Exit full-grid takeover back to paged looper rows on the right grid. */
            nextFullGrid = false;
            nextSection = 1;
            nextPage = maxPage;
        } else {
            nextSection = nextSection === 1 ? 0 : 1;
        }
    } else if (dir > 0) {
        if (nextPage < maxPage) {
            nextPage++;
        } else {
            nextFullGrid = true;
            nextSection = 0; /* first full-grid takeover appears on the left grid */
        }
    } else {
        if (nextPage > 0) nextPage--;
        nextSection = 1;
    }

    const changed = nextPage !== s.loopPadPage || nextSection !== s.loopPadSection || nextFullGrid !== s.loopPadFullGrid;
    s.loopPadPage = nextPage;
    s.loopPadSection = nextSection;
    s.loopPadFullGrid = nextFullGrid;
    if (!changed) return false;

    const secLabel = s.loopPadSection === 1 ? 'right' : 'left';
    if (s.loopPadFullGrid) showStatus('Loopers 1-16 on ' + secLabel + ' grid', 90);
    else {
        const end = Math.min(s.midiLoopers.length, (s.loopPadPage + 1) * LOOPER_PAGE_SIZE);
        showStatus('Loopers ' + (s.loopPadPage * LOOPER_PAGE_SIZE + 1) + '-' + end + ' on top row', 90);
    }
    markLedsDirty();
    return true;
}

function tickMidiLooperButtonHold() {
    const l = currentLooper();
    if (!l.buttonHeld || l.eraseHoldTriggered) return;
    if (l.buttonDownTick < 0) return;
    if ((s.transportTicks - l.buttonDownTick) < LOOP_ERASE_HOLD_TICKS) return;
    l.eraseHoldTriggered = true;
    if (l.holdEraseArmed) {
        looperErase();
        l.holdEraseArmed = false;
        return;
    }
    if (l.state === 'playing') {
        looperUndoLastLayer();
        l.buttonHeld = false;
        l.buttonDownTick = -1;
    }
}

function isPadMuted(sec, bank, slot) {
    return !!slotAt(sec, bank, slot).muted;
}

function togglePadMute(sec, bank, slot) {
    const sl = slotAt(sec, bank, slot);
    sl.muted = sl.muted ? 0 : 1;
    markLedsDirty();
    markSessionChanged();
    showStatus('S' + (sec + 1) + 'B' + (bank + 1) + 'P' + (slot + 1) + ' ' + (sl.muted ? 'Muted' : 'Unmuted'), 90);
    s.dirty = true;
}

function eraseLooperAt(index) {
    const idx = clampInt(index, 0, s.midiLoopers.length - 1, 0);
    if (idx !== s.activeLooper) selectLooper(idx);
    ensureValidActiveLooper();
    looperErase();
}

function eraseLooperNotesForPad(sec, bank, slot) {
    const looperIdx = ensureValidActiveLooper();
    const l = looperByIndex(looperIdx);
    if (!l || !Array.isArray(l.events) || !l.events.length) return false;
    const before = l.events.length;
    l.events = l.events.filter((ev) => !(ev.sec === sec && ev.bank === bank && ev.slot === slot));
    if (l.quantized && Array.isArray(l.preQuantizeEvents) && l.preQuantizeEvents.length) {
        l.preQuantizeEvents = l.preQuantizeEvents.filter((ev) => !(ev.sec === sec && ev.bank === bank && ev.slot === slot));
    }
    if (!l.events.length) {
        l.state = 'empty';
        l.loopLengthMs = 0;
        l.quantized = 0;
        l.preQuantizeEvents = [];
        l.layerStack = [];
    }
    if (l.events.length === before) return false;
    markSessionChanged();
    updateUtilityButtonLeds();
    showStatus('Looper ' + (looperIdx + 1) + ' notes erased P' + (slot + 1), 100);
    return true;
}

function flashPadPress(sec, bank, slot) {
    const key = sec + ':' + bank + ':' + slot;
    s.padPressFlash[key] = s.transportTicks + PAD_PRESS_FLASH_TICKS;
    markLedsDirty();
}

function triggerPadOn(sec, bank, slot, velocity, routeBank, recordToLooper = true, sourceTag = '') {
    if (isPadMuted(sec, bank, slot)) return false;
    flashPadPress(sec, bank, slot);
    s.lastPadTriggerTick = s.transportTicks;
    const sl = slotAt(sec, bank, slot);
    const effectiveRouteBank = !!routeBank;
    const triggerNote = padNoteFor(sec, slot);
    const vel = s.velocitySens ? clampInt(velocity, 1, 127, 100) : 127;
    const nowMs = Date.now();
    const key = addrKey(sec, bank, slot);
    const existing = activeVoicesByAddr[key];
    const src = String(sourceTag || '');
    if (existing) {
        const sameSource = src && existing.sourceTag === src;
        const deltaMs = Math.max(0, nowMs - clampInt(existing.lastOnMs, 0, 0x7fffffff, nowMs));
        if (sameSource && deltaMs <= MIDI_DUPLICATE_NOTE_ON_GUARD_MS) return true;
        releaseActiveVoice(existing.sec, existing.bank, existing.slot, !!existing.routeBank, recordToLooper, nowMs, true);
        flushPendingNoteOffs();
    }
    clearPendingOff(sec, bank, slot);
    if (effectiveRouteBank) {
        withPlaybackBank(sec, bank, () => {
            spe('pad_note_on', triggerNote + ':' + vel);
        });
    } else {
        spe('pad_note_on', triggerNote + ':' + vel);
    }
    sendMidiOut(slot, vel, sec, bank, true);
    if (recordToLooper) looperRecordEvent('on', sec, bank, slot, vel);
    activeVoicesByAddr[key] = {
        sec,
        bank,
        slot,
        routeBank: effectiveRouteBank,
        owner: src,
        sourceTag: src,
        velocity: vel,
        startedMs: nowMs,
        lastOnMs: nowMs
    };
    setPadPlaybackState(sec, bank, slot, 'playing');
    /* no-op: avoid implicit loop retriggers from non-loop pads */
    markLedsDirty();
    return true;
}

function triggerPadOff(sec, bank, slot, routeBank, recordToLooper = true) {
    const addr = { sec, bank, slot };
    const voice = currentVoiceAt(sec, bank, slot);
    if (!voice && !shouldSendNoteOffForAddr(addr)) return false;
    return releaseActiveVoice(sec, bank, slot, voice ? !!voice.routeBank : routeBank, recordToLooper, Date.now());
}

function tickMidiLooperPlayback() {
    const l = currentLooper();
    if ((l.state !== 'playing' && l.state !== 'overdub') || l.loopLengthMs <= 0 || !l.events.length) return;

    const now = looperNowMs();
    const elapsed = Math.max(0, now - l.playStartMs);
    const prev = l.loopPosMs;
    const cur = elapsed % l.loopLengthMs;
    l.lastLoopPosMs = prev;
    l.loopPosMs = cur;

    for (let i = 0; i < l.events.length; i++) {
        const ev = l.events[i];
        const t = clampInt(ev.atMs, 0, Math.max(0, l.loopLengthMs - 1), 0);
        const crossed = (prev < cur)
            ? (t > prev && t <= cur)
            : (prev > cur ? (t > prev || t <= cur) : false);
        if (!crossed) continue;
        if (ev.type === 'on') {
            if (isPadMuted(ev.sec, ev.bank, ev.slot)) continue;
            const vel = clampInt(ev.velocity, 1, 127, 100);
            triggerPadOn(ev.sec, ev.bank, ev.slot, vel, true, false, 'looper:' + String(clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0)));
        } else {
            triggerPadOff(ev.sec, ev.bank, ev.slot, true, false);
        }
    }
}

function tickPadPressFlash() {
    const keys = Object.keys(s.padPressFlash);
    if (!keys.length) return;
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const until = clampInt(s.padPressFlash[k], 0, 0x7fffffff, 0);
        if (until > s.transportTicks) continue;
        delete s.padPressFlash[k];
        changed = true;
    }
    if (changed) markLedsDirty();
}

function tickMidiEchoCache() {
    if (!s.midiEchoSuppression) return;
    const now = Date.now();
    const keys = Object.keys(s.recentOutboundMidi);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const ts = clampInt(s.recentOutboundMidi[k], 0, 0x7fffffff, 0);
        if (!ts || (now - ts) > (MIDI_ECHO_SUPPRESS_WINDOW_MS * 4)) delete s.recentOutboundMidi[k];
    }
}

function looperForPerfFxSync() {
    const current = currentLooper();
    if (current &&
        current.state !== 'empty' &&
        clampInt(current.loopLengthMs, 0, 1200000, 0) > 0) {
        return current;
    }
    return null;
}

function syncPerfFxLoopLength() {
    const l = looperForPerfFxSync();
    if (!l) return;
    const len = clampInt(l.loopLengthMs, 0, 1200000, 0);
    if (len <= 0) return;

    /* Keep loop-length sync for time-based PFX and expose BPM hint for DSPs that support it. */
    const bpm = clampFloat(240000.0 / len, 20.0, 300.0, 120.0);
    sp('performance_fx_loop_length_ms', String(len));
    sp('pfx_loop_length_ms', String(len));
    sp('performance_fx_loop_bpm', bpm.toFixed(2));
    sp('pfx_loop_bpm', bpm.toFixed(2));
}

function addrKey(sec, bank, slot) {
    return String(clampInt(sec, 0, GRID_COUNT - 1, 0)) + ':' +
        String(clampInt(bank, 0, BANK_COUNT - 1, 0)) + ':' +
        String(clampInt(slot, 0, GRID_SIZE - 1, 0));
}

function setPadPlaybackState(sec, bank, slot, nextState) {
    const key = addrKey(sec, bank, slot);
    if (nextState === 'idle') delete s.padPlaybackState[key];
    else s.padPlaybackState[key] = nextState;
}

function currentVoiceAt(sec, bank, slot) {
    return activeVoicesByAddr[addrKey(sec, bank, slot)] || null;
}

function clearPendingOff(sec, bank, slot) {
    delete pendingNoteOffsByAddr[addrKey(sec, bank, slot)];
}

function emitPadNoteOffNow(sec, bank, slot, routeBank, recordToLooper) {
    const triggerNote = padNoteFor(sec, slot);
    if (routeBank) {
        withPlaybackBank(sec, bank, () => {
            spe('pad_note_off', String(triggerNote));
        });
    } else {
        spe('pad_note_off', String(triggerNote));
    }
    sendMidiOut(slot, 0, sec, bank, false);
    if (recordToLooper) looperRecordEvent('off', sec, bank, slot, 0);
}

function releaseActiveVoice(sec, bank, slot, routeBank, recordToLooper, nowMs = Date.now(), forceImmediate = false) {
    const key = addrKey(sec, bank, slot);
    const voice = activeVoicesByAddr[key];
    if (!voice) return false;
    const effectiveRouteBank = !!voice.routeBank;

    const elapsed = Math.max(0, nowMs - clampInt(voice.startedMs, 0, 0x7fffffff, nowMs));
    if (!forceImmediate && elapsed < MIDI_MIN_NOTE_LENGTH_MS) {
        pendingNoteOffsByAddr[key] = {
            sec,
            bank,
            slot,
            routeBank: effectiveRouteBank,
            recordToLooper: !!recordToLooper,
            dueAtMs: nowMs + (MIDI_MIN_NOTE_LENGTH_MS - elapsed)
        };
        setPadPlaybackState(sec, bank, slot, 'stopping');
        return true;
    }

    clearPendingOff(sec, bank, slot);
    emitPadNoteOffNow(sec, bank, slot, effectiveRouteBank, recordToLooper);
    delete activeVoicesByAddr[key];
    setPadPlaybackState(sec, bank, slot, 'idle');
    markLedsDirty();
    return true;
}

function releaseVoicesByOwner(ownerPrefix, nowMs = Date.now()) {
    const keys = Object.keys(activeVoicesByAddr);
    for (let i = 0; i < keys.length; i++) {
        const v = activeVoicesByAddr[keys[i]];
        if (!v) continue;
        if (!String(v.owner || '').startsWith(ownerPrefix)) continue;
        clearPendingOff(v.sec, v.bank, v.slot);
        emitPadNoteOffNow(v.sec, v.bank, v.slot, !!v.routeBank, false);
        delete activeVoicesByAddr[keys[i]];
        setPadPlaybackState(v.sec, v.bank, v.slot, 'idle');
    }
    markLedsDirty();
}

function flushPendingNoteOffs() {
    const now = Date.now();
    const keys = Object.keys(pendingNoteOffsByAddr);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const p = pendingNoteOffsByAddr[key];
        if (!p) continue;
        if (now < clampInt(p.dueAtMs, 0, 0x7fffffff, 0)) continue;
        emitPadNoteOffNow(p.sec, p.bank, p.slot, !!p.routeBank, !!p.recordToLooper);
        delete activeVoicesByAddr[key];
        delete pendingNoteOffsByAddr[key];
        setPadPlaybackState(p.sec, p.bank, p.slot, 'idle');
        markLedsDirty();
    }
}

function activeSampleVoiceCount() {
    return Object.keys(activeVoicesByAddr).length;
}

function stopAllActiveSamplePlaybackNow() {
    const keys = Object.keys(activeVoicesByAddr);
    if (!keys.length) return 0;

    let stopped = 0;
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) {
        const v = activeVoicesByAddr[keys[i]];
        if (!v) continue;
        if (releaseActiveVoice(v.sec, v.bank, v.slot, !!v.routeBank, false, now, true)) stopped++;
    }
    flushPendingNoteOffs();
    if (stopped > 0) {
        markLedsDirty();
        updateUtilityButtonLeds();
        s.dirty = true;
    }
    return stopped;
}

function toggleFxPadByNote(note) {
    const slice = sliceFromPadNote(note);
    if (slice < 0) return false;
    const sec = sectionFromSlice(slice);
    const slot = slotFromSlice(slice);
    const fxIdx = fxEffectFromPadSlot(slot);
    if (fxIdx < 0) {
        showStatus('FX pads: bottom rows + DJFX', 50);
        return true;
    }
    if (sec === 0) {
        const bankSec = s.focusedSection;
        const bank = focusedBankIndex(bankSec);
        const eff = bankFxEffect(bankSec, bank, fxIdx);
        s.selectedBankFxEffect = fxIdx;
        s.fxScreenScope = 'bank';
        eff.enabled = eff.enabled ? 0 : 1;
        sendFxToggleToDsp('bank', bankSec, bank, fxIdx);
        showStatus('Bank ' + fxSlotName('bank', fxIdx) + ' ' + (eff.enabled ? 'ON' : 'OFF'), 80);
        markSessionChanged();
    } else {
        const eff = globalFxEffect(fxIdx);
        s.selectedGlobalFxEffect = fxIdx;
        s.fxScreenScope = 'global';
        eff.enabled = eff.enabled ? 0 : 1;
        sendFxToggleToDsp('global', 0, 0, fxIdx);
        showStatus('Global ' + fxSlotName('global', fxIdx) + ' ' + (eff.enabled ? 'ON' : 'OFF'), 80);
        markSessionChanged();
    }
    markLedsDirty();
    updateUtilityButtonLeds();
    s.dirty = true;
    return true;
}

function fxParamName(scope, effectIdx, paramIdx) {
    const fx = clampInt(effectIdx, 0, FX_EFFECT_COUNT - 1, 0);
    const p = clampInt(paramIdx, 0, FX_PARAM_COUNT - 1, 0);
    const labels = fxParamLabels(scope, fx);
    if (Array.isArray(labels) && typeof labels[p] === 'string' && labels[p]) return labels[p];
    return 'P' + (p + 1);
}

function fxParamCode(scope, effectIdx, paramIdx) {
    const label = String(fxParamName(scope, effectIdx, paramIdx) || '');
    const cleaned = label.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleaned.length) return 'P';
    return cleaned.charAt(0);
}

function fxParamCompactToken(scope, effectIdx, paramIdx, value) {
    const idx = clampInt(paramIdx, 0, FX_PARAM_COUNT - 1, 0);
    if (idx === 0) {
        const preset = fxPresetIndexFromValue(value) + 1;
        return '1P' + preset;
    }
    const code = fxParamCode(scope, effectIdx, idx);
    const pct = clampInt(Math.round(clampFloat(value, 0.0, 1.0, 0.5) * 99), 0, 99, 50);
    const vv = String(pct).padStart(2, '0');
    return String(idx + 1) + code + vv;
}

function adjustSelectedFxParam(knobIdx, delta) {
    if (delta === 0) return;
    const paramIdx = clampInt(knobIdx, 0, FX_PARAM_COUNT - 1, 0);
    if (s.fxScreenScope === 'global') {
        const effectIdx = clampInt(s.selectedGlobalFxEffect, 0, FX_EFFECT_COUNT - 1, 0);
        const eff = globalFxEffect(effectIdx);
        let sendAll = false;
        if (paramIdx === 0) {
            const cur = fxPresetIndexFromValue(Array.isArray(eff.params) ? eff.params[0] : defaultFxParam(effectIdx, 0, 'global'));
            const next = clamp(cur + (delta > 0 ? 1 : -1), 0, FX_PRESET_COUNT - 1);
            applyPresetToFxState(effectIdx, eff, next, 'global');
            sendAll = true;
        } else {
            eff.params[paramIdx] = clamp(clampFloat(eff.params[paramIdx], 0.0, 1.0, defaultFxParam(effectIdx, paramIdx, 'global')) + delta * 0.02, 0.0, 1.0);
        }
        if (sendAll) {
            for (let p = 0; p < FX_PARAM_COUNT; p++) sendFxParamToDsp('global', 0, 0, effectIdx, p);
        } else {
            sendFxParamToDsp('global', 0, 0, effectIdx, paramIdx);
        }
        if (paramIdx === 0) showStatus('Global ' + fxSlotName('global', effectIdx) + ' Preset ' + (fxPresetIndexFromValue(eff.params[0]) + 1), 70);
        else showStatus('Global ' + fxSlotName('global', effectIdx) + ' ' + fxParamName('global', effectIdx, paramIdx) + ' ' + Math.round(eff.params[paramIdx] * 100), 70);
    } else {
        const sec = s.focusedSection;
        const bank = focusedBankIndex(sec);
        const effectIdx = clampInt(s.selectedBankFxEffect, 0, FX_EFFECT_COUNT - 1, 0);
        const eff = bankFxEffect(sec, bank, effectIdx);
        let sendAll = false;
        if (paramIdx === 0) {
            const cur = fxPresetIndexFromValue(Array.isArray(eff.params) ? eff.params[0] : defaultFxParam(effectIdx, 0, 'bank'));
            const next = clamp(cur + (delta > 0 ? 1 : -1), 0, FX_PRESET_COUNT - 1);
            applyPresetToFxState(effectIdx, eff, next, 'bank');
            sendAll = true;
        } else {
            eff.params[paramIdx] = clamp(clampFloat(eff.params[paramIdx], 0.0, 1.0, defaultFxParam(effectIdx, paramIdx, 'bank')) + delta * 0.02, 0.0, 1.0);
        }
        if (sendAll) {
            for (let p = 0; p < FX_PARAM_COUNT; p++) sendFxParamToDsp('bank', sec, bank, effectIdx, p);
        } else {
            sendFxParamToDsp('bank', sec, bank, effectIdx, paramIdx);
        }
        if (paramIdx === 0) showStatus('Bank ' + fxSlotName('bank', effectIdx) + ' Preset ' + (fxPresetIndexFromValue(eff.params[0]) + 1), 70);
        else showStatus('Bank ' + fxSlotName('bank', effectIdx) + ' ' + fxParamName('bank', effectIdx, paramIdx) + ' ' + Math.round(eff.params[paramIdx] * 100), 70);
    }
    markSessionChanged();
    updateUtilityButtonLeds();
    s.dirty = true;
}

function handlePadNote(note, velocity) {
    if (velocity <= 0) return false;
    if (note < PAD_NOTE_MIN || note > PAD_NOTE_MAX) return false;
    if (s.view === 'fx') return toggleFxPadByNote(note);

    const directSlice = sliceFromPadNote(note);
    if (s.shiftHeld && s.volumeTouchHeld) {
        if (directSlice < 0) return false;
        const sec = sectionFromSlice(directSlice);
        const bank = focusedBankIndex(sec);
        const slot = slotFromSlice(directSlice);
        delete s.activePadPress[String(note)];
        setSelectedSlice(directSlice, true);
        const cur = slotAt(sec, bank, slot).reverse ? 1 : 0;
        setSlotReverse(sec, bank, slot, cur ? 0 : 1, true);
        showStatus('P' + (slot + 1) + ' Reverse ' + (slotAt(sec, bank, slot).reverse ? 'ON' : 'OFF'), 90);
        s.dirty = true;
        return true;
    }

    if (s.loopPadMode) {
        const lp = loopPadIndexFromPadNote(note);
        if (lp >= 0) {
            fireLooperPad(lp);
            return true;
        }
    }

    const slice = s.shiftHeld ? directSlice : playableSliceFromPadNote(note);
    if (slice < 0) return false;
    const sec = sectionFromSlice(slice);
    const bank = focusedBankIndex(sec);
    const slot = slotFromSlice(slice);
    const addr = { sec, bank, slot };
    const triggerNote = padNoteFor(sec, slot);

    if (s.deleteHeld && !s.shiftHeld) {
        if (eraseLooperNotesForPad(sec, bank, slot)) return true;
        showStatus('No looper notes on that pad', 80);
        return true;
    }

    if (s.muteHeld && !s.shiftHeld) {
        togglePadMute(sec, bank, slot);
        return true;
    }

    if (!s.shiftHeld) {
        const sl = slotAt(sec, bank, slot);
        if (sl.loop > 0) {
            const existing = currentVoiceAt(sec, bank, slot);
            if (existing) {
                releaseActiveVoice(sec, bank, slot, false, true, Date.now(), true);
                delete s.activePadPress[String(note)];
                s.editScope = 'P';
                setSelectedSlice(slice, false, false);
                return true;
            }
            /* Route loop/ping pads through bank routing to avoid mono choke interactions. */
            triggerPadOn(sec, bank, slot, velocity, true, true, 'pad-toggle:' + String(note));
            s.activePadPress[String(note)] = {
                sec,
                bank,
                slot,
                triggerNote,
                velocity: clampInt(velocity, 1, 127, 100),
                loopHoldMode: true,
                loopToggleCandidate: true,
                pressedAtMs: Date.now()
            };
            s.editScope = 'P';
            setSelectedSlice(slice, false, false);
            return true;
        }
        if (!triggerPadOn(sec, bank, slot, velocity, false, true, 'pad:' + String(note))) return true;
        s.activePadPress[String(note)] = { sec, bank, slot, triggerNote, velocity: clampInt(velocity, 1, 127, 100) };
        s.editScope = 'P';
        setSelectedSlice(slice, false, false);
    } else {
        delete s.activePadPress[String(note)];
        setSelectedSlice(slice, true);
        if (s.recording || isRecordTransitionPending()) {
            showStatus('REC focus ' + recordTargetLabel({ sec, bank, slot }), 60);
            return true;
        }
    }

    if (s.shiftHeld) {
        if (!s.copySource) {
            s.copySource = copyAddr(addr);
            showStatus('Copy src S' + (sec + 1) + ' B' + (bank + 1) + ' P' + (slot + 1), 100);
            markLedsDirty();
        } else if (!sameAddr(s.copySource, addr)) {
            copySlotBetween(s.copySource, addr);
            showStatus('Copied to S' + (sec + 1) + ' B' + (bank + 1) + ' P' + (slot + 1), 100);
        }
    }

    return true;
}

function handlePadNoteRelease(note) {
    if (note < PAD_NOTE_MIN || note > PAD_NOTE_MAX) return false;
    if (s.view === 'fx') return true;
    if (s.loopPadMode) {
        const lp = loopPadIndexFromPadNote(note);
        if (lp >= 0) {
            if (lp === s.activeLooper) handleLoopButtonRelease();
            return true;
        }
    }
    const stored = s.activePadPress[String(note)];
    delete s.activePadPress[String(note)];
    if (!stored) return true;
    const addr = stored;
    if (slotAt(addr.sec, addr.bank, addr.slot).loop > 0) {
        if (!stored.loopToggleCandidate) return true;
        const heldMs = Math.max(0, Date.now() - clampMsTimestamp(stored.pressedAtMs, Date.now()));
        if (stored.loopHoldMode && heldMs >= LOOP_TOGGLE_HOLD_THRESHOLD_MS) {
            triggerPadOff(addr.sec, addr.bank, addr.slot, false);
        }
        return true;
    }

    triggerPadOff(addr.sec, addr.bank, addr.slot, false);
    return true;
}

function withPlaybackBank(sec, bank, fn) {
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const targetBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    const visibleBank = clampInt(s.sections[sSec].currentBank, 0, BANK_COUNT - 1, 0);

    /* Route playback without moving wrapper PFX focus. */
    spb('section_bank_route', sSec + ':' + targetBank, 120);
    try {
        fn();
    } finally {
        if (targetBank !== visibleBank) spb('section_bank_route', sSec + ':' + visibleBank, 120);
    }
}

function sendMidiOut(pad, velocity, side, bank, isNoteOn, polyPressure) {
    const padIdx = clampInt(pad, 0, GRID_SIZE - 1, 0);
    const vel = clampInt(velocity, 0, 127, 0);
    const ch = getChannel(side, bank);
    const note = getNoteForPad(padIdx);
    const statusBase = isNoteOn ? 0x90 : 0x80;
    sendExternalMidi([statusBase | midiChannelNibbleFrom1Based(ch), note, vel]);
    if (isNoteOn && MIDI_OUT_POLY_AFTERTOUCH) {
        const press = clampInt(polyPressure, 0, 127, vel);
        sendExternalMidi([0xA0 | midiChannelNibbleFrom1Based(ch), note, press]);
    }
}

function handleMidiIn(msg) {
    const packet = unpackMidiMessage(msg);
    if (!packet) return;
    const statusRaw = packet[0];
    const status = statusRaw & 0xF0;
    const channel1Based = (statusRaw & 0x0F) + 1;
    const note = packet[1];
    const value = packet[2];
    if (shouldSuppressEchoedMidi(statusRaw, note, value)) return;

    const route = getBankFromChannel(channel1Based);
    if (!route) return;
    const side = route.side;
    const bank = route.bank;
    const pad = getPadFromNote(note);
    if (pad < 0) return;

    const sec = side;
    const slot = pad;
    const triggerNote = padNoteFor(sec, slot);
    const key = String(channel1Based) + ':' + String(note);

    if (status === 0x90 && value > 0) {
        if (!triggerPadOn(sec, bank, slot, value, true, true, 'ext:' + key)) return;
        midiHeldByChannelNote[key] = { sec, bank, slot, triggerNote };
        return;
    }

    if (status === 0x80 || (status === 0x90 && value === 0)) {
        const held = midiHeldByChannelNote[key] || { sec, bank, slot, triggerNote };
        delete midiHeldByChannelNote[key];
        triggerPadOff(held.sec, held.bank, held.slot, true);
    }
}

function handleMainKnob(delta) {
    if (delta === 0) return;

    if (s.view === 'browser') {
        browserScrollBy(delta);
        return;
    }

    if (s.shiftHeld) {
        setSectionMode(s.focusedSection, delta > 0 ? MODE_PER_SLOT : MODE_SINGLE);
        return;
    }

    adjustRecordMaxSeconds(delta);
}

function ensureFocusedEditTargetForKnobs() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const slot = focusedSlotIndex();
    const dspSlice = clampInt(dspSliceFromSecSlot(sec, slot), 0, TOTAL_PADS - 1, 0);
    spb('section_bank', sec + ':' + bank, 120);
    spb('selected_slice', String(dspSlice), 120);
    spb('keyboard_section', String(sec), 120);
    ensureEditCursor(true);
}

function handleParamKnob(cc, delta) {
    if (delta === 0) return;

    if (s.view === 'browser' && s.browserMode === 'sessions') {
        if (cc === MoveKnob1) adjustSessionNameIndex(delta);
        else if (cc === MoveKnob2) adjustSessionNameChar(delta);
        return;
    }

    if (s.view === 'fx') {
        if (cc >= MoveKnob1 && cc <= MoveKnob8) {
            s.knobPage = (cc <= MoveKnob4) ? 'A' : 'B';
            adjustSelectedFxParam(cc - MoveKnob1, delta);
        }
        return;
    }

    if (s.view !== 'main') return;

    const inA = cc === MoveKnob1 || cc === MoveKnob2 || cc === MoveKnob3 || cc === MoveKnob4;
    const inB = cc === MoveKnob5 || cc === MoveKnob6 || cc === MoveKnob7 || cc === MoveKnob8;
    if (!inA && !inB) return;

    ensureFocusedEditTargetForKnobs();

    if (s.shiftHeld && s.volumeTouchHeld) {
        if (cc === MoveKnob3) {
            adjustPadPan(delta);
            return;
        }
        if (cc === MoveKnob4) {
            adjustAllPan(delta);
            return;
        }
        if (cc === MoveKnob1) {
            adjustFocusedBankFilter(delta);
            return;
        }
        if (cc === MoveKnob2) {
            adjustFocusedBankEmulation(delta);
            return;
        }
        if (cc === MoveKnob5) {
            toggleEditScope();
            return;
        }
        if (cc === MoveKnob6) {
            propagateFocusedSourceBank();
            return;
        }
        if (cc === MoveKnob7) {
            adjustFocusedBankColor(delta);
            return;
        }
        if (cc === MoveKnob8) {
            adjustFocusedPadColor(delta);
            return;
        }
    }

    if (s.shiftHeld && !s.volumeTouchHeld) {
        if (cc === MoveKnob1) {
            adjustAllAttack(delta);
            return;
        }
        if (cc === MoveKnob2) {
            adjustAllDecay(delta);
            return;
        }
        if (cc === MoveKnob3) {
            adjustAllStartTrim(delta);
            return;
        }
        if (cc === MoveKnob4) {
            adjustAllEndTrim(delta);
            return;
        }
        if (cc === MoveKnob5) {
            toggleAllMode();
            return;
        }
        if (cc === MoveKnob6) {
            adjustFocusedBankPitch(delta);
            return;
        }
        if (cc === MoveKnob7) {
            adjustAllGain(delta);
            return;
        }
        if (cc === MoveKnob8) {
            adjustAllLoop(delta);
            return;
        }
    }

    s.knobPage = inA ? 'A' : 'B';

    if (s.editScope === 'P') {
        if (cc === MoveKnob1) adjustPadAttack(delta);
        else if (cc === MoveKnob2) adjustPadDecay(delta);
        else if (cc === MoveKnob3) adjustPadStartTrim(delta);
        else if (cc === MoveKnob4) adjustPadEndTrim(delta);
        else if (cc === MoveKnob5) { if (consumeBinaryKnobTurn('pad-mode', delta)) togglePadMode(); }
        else if (cc === MoveKnob6) adjustPadPitch(delta);
        else if (cc === MoveKnob7) adjustPadGain(delta);
        else if (cc === MoveKnob8) adjustPadLoop(delta);
    } else {
        if (cc === MoveKnob1) adjustAllAttack(delta);
        else if (cc === MoveKnob2) adjustAllDecay(delta);
        else if (cc === MoveKnob3) adjustAllStartTrim(delta);
        else if (cc === MoveKnob4) adjustAllEndTrim(delta);
        else if (cc === MoveKnob5) { if (consumeBinaryKnobTurn('all-mode', delta)) toggleAllMode(); }
        else if (cc === MoveKnob6) adjustGlobalPitch(delta);
        else if (cc === MoveKnob7) adjustGlobalGain(delta);
        else if (cc === MoveKnob8) adjustAllLoop(delta);
    }

    s.dirty = true;
}

function tickStatusTimer() {
    if (s.statusTicks <= 0) return;
    s.statusTicks--;
    if (s.statusTicks === 0) s.dirty = true;
}

function tickAutosave() {
    if (!s.autosavePending) return;
    if (s.autosaveTicks > 0) {
        s.autosaveTicks--;
        return;
    }
    saveAutosaveSession(false);
}

function syncFromDsp() {
    pollRecordingState();
    tickRecordStateMachine();
    tickRecordButtonBlink();
    syncFocusedSlotPlaybackCompat();
    if (s.focusedParamRefreshTicks > 0) {
        s.focusedParamRefreshTicks--;
        invalidatePlaybackCompat();
        syncFocusedSlotPlaybackCompat(true);
    }
    if (s.trimReplayTicks > 0) {
        s.trimReplayTicks--;
        if (s.trimReplayTicks === 0 && s.trimReplayPendingAll) {
            s.trimReplayPendingAll = false;
            replayAllSlotParamsToDsp();
            invalidatePlaybackCompat();
            syncFocusedSlotPlaybackCompat(true);
        }
    }
}

function initFromDspDefaults() {
    s.sections[0].mode = clampInt(gp('section_mode_0', MODE_SINGLE), 0, 1, MODE_SINGLE);
    s.sections[1].mode = clampInt(gp('section_mode_1', MODE_PER_SLOT), 0, 1, MODE_PER_SLOT);

    s.sections[0].currentBank = clampInt(gp('section_bank_0', 0), 0, BANK_COUNT - 1, 0);
    s.sections[1].currentBank = clampInt(gp('section_bank_1', 0), 0, BANK_COUNT - 1, 0);

    const b0 = s.sections[0].banks[s.sections[0].currentBank];
    const b1 = s.sections[1].banks[s.sections[1].currentBank];
    b0.chopCount = normalizeChopCount(gp('section_chop_count_0', b0.chopCount));
    b1.chopCount = normalizeChopCount(gp('section_chop_count_1', b1.chopCount));
    b0.slicePage = clampInt(gp('section_slice_page_0', b0.slicePage), 0, maxPagesForBank(b0) - 1, 0);
    b1.slicePage = clampInt(gp('section_slice_page_1', b1.slicePage), 0, maxPagesForBank(b1) - 1, 0);
    b0.transientSensitivity = normalizeTransientSensitivity(gp(bankSliceStateKey('section_transient_sensitivity', 0, s.sections[0].currentBank), b0.transientSensitivity));
    b1.transientSensitivity = normalizeTransientSensitivity(gp(bankSliceStateKey('section_transient_sensitivity', 1, s.sections[1].currentBank), b1.transientSensitivity));
    syncBankSliceState(0, s.sections[0].currentBank);
    syncBankSliceState(1, s.sections[1].currentBank);

    s.globalGain = clampFloat(gp('global_gain', 1.0), 0.0, 4.0, 1.0);
    s.globalPitch = clampFloat(gp('global_pitch', 0.0), -48.0, 48.0, 0.0);
    s.velocitySens = clampInt(gp('velocity_sens', 0), 0, 1, 0);

    const dspSel = clampInt(gp('selected_slice', 0), 0, TOTAL_PADS - 1, 0);
    s.selectedSlice = customSliceFromDspSlice(dspSel);
    if (LEFT_GRID_ONLY) s.selectedSlice = slotFromSlice(s.selectedSlice);
    s.focusedSection = LEFT_GRID_ONLY ? 0 : sectionFromSlice(s.selectedSlice);

    s.recording = clampInt(gp('recording', 0), 0, 1, 0);
    s.lastRecordedPath = String(gp('last_recorded_path', '') || '');
    s.recordStartLastPath = s.lastRecordedPath;
    clearPendingRecordedPath();
    s.recordArmed = s.recording ? true : false;
    s.recordState = s.recording ? 'recording' : (s.recordArmed ? 'armed' : 'idle');
    s.recordStateTicks = 0;
    s.recordLoadOnStop = false;
    s.recordMonitorOn = s.recording ? true : false;
    s.recordBlinkOn = s.recording ? true : false;
    s.recordBlinkTicks = 0;
    updateRecordButtonLed();

    sp('keyboard_section', String(s.focusedSection));
    sp('record_max_seconds', String(s.recordMaxSeconds));

    ensureEditCursor();
    markLedsDirty();
}

function onMidiMessageInternal(data) {
    if (!data || typeof data.length !== 'number' || data.length < 3) return;

    const status = (clampInt(data[0], 0, 255, 0) & 0xF0);
    const b1 = clampInt(data[1], 0, 127, 0);
    const b2 = clampInt(data[2], 0, 127, 0);

    if ((status === 0x90 || status === 0x80) && b1 === MoveMasterTouch) {
        s.volumeTouchHeld = (status === 0x90 && b2 > 0) ? true : false;
        return;
    }

    beginHistoryTransaction();
    try {
        if (status === 0x90) {
            if (b2 === 0) {
                if (handleStepBankRelease(b1)) return;
                if (handlePadNoteRelease(b1)) return;
                return;
            }
            if (handleKnobTouch(b1, b2)) return;
            if (handleStepBankNote(b1, b2)) return;
            if (handlePadNote(b1, b2)) return;
            return;
        }

        if (status === 0x80) {
            if (handleStepBankRelease(b1)) return;
            if (handlePadNoteRelease(b1)) return;
            return;
        }

        if (status !== 0xB0) return;

        const cc = b1;
        const val = b2;

        if (cc === MoveShift) {
            const wasHeld = s.shiftHeld;
            s.shiftHeld = val > 0;
            if (s.shiftHeld) clearStepFxHold(true);
            if (wasHeld && !s.shiftHeld) {
                let changed = false;
                if (s.copySource) {
                    s.copySource = null;
                    changed = true;
                }
                if (s.stepCopySource) {
                    s.stepCopySource = null;
                    changed = true;
                }
                if (changed) markLedsDirty();
            }
            return;
        }

        if (cc === MoveMute) {
            s.muteHeld = val > 0;
            if (s.muteHeld) showStatus('Mute hold: tap pad (loop=erase notes)', 80);
            updateUtilityButtonLeds();
            return;
        }

        if (cc === MoveLoop) {
            if (val > 0 && s.shiftHeld) {
                toggleLoopPadMode();
                return;
            }
            if (val > 0) handleLoopButtonPress();
            else handleLoopButtonRelease();
            return;
        }

        if (cc === MovePlay && val > 0) {
            const isDoublePress = (s.transportTicks - clampInt(s.playLastPressTick, -9999, 0x7fffffff, -9999)) <= PLAY_DOUBLE_PRESS_TICKS;
            s.playLastPressTick = s.transportTicks;
            if (isDoublePress && activeSampleVoiceCount() > 0) {
                const stopped = stopAllActiveSamplePlaybackNow();
                if (stopped > 0) {
                    showStatus('Stopped ' + stopped + ' sample' + (stopped === 1 ? '' : 's'), 90);
                    return;
                }
            }
            toggleActiveLooperClipPlayback();
            return;
        }

        if ((cc === MoveRec || cc === MoveRecord) && val > 0) {
            handleRecordButtonPress();
            return;
        }

        if (cc === MoveUndo && val > 0) {
            if (s.shiftHeld) {
                redoSessionState();
            } else if (!looperUndoLastLayer()) {
                undoSessionState();
            }
            return;
        }

        if (cc === MoveMaster) {
            const delta = decodeDelta(val);
            if (delta !== 0 && s.shiftHeld) {
                adjustGlobalGain(delta);
            }
            return;
        }

        if (cc === MoveDelete) {
            s.deleteHeld = val > 0;
            if (val <= 0) return;
            if (s.view === 'browser' && s.browserMode === 'sessions') {
                deleteSelectedSession();
                return;
            }
            if (s.view === 'browser' && s.browserMode === 'samples') {
                deleteSelectedSampleFile();
                return;
            }
            if (s.view === 'main') {
                if (s.loopPadMode) {
                    showStatus('Looper mode: Delete disabled for samples', 90);
                    return;
                }
                if (s.shiftHeld) clearFocusedBankAudio();
                else clearFocusedPadAudio();
            }
            return;
        }

        if (cc === MoveMenu && val > 0) {
            if (s.shiftHeld && (s.view !== 'browser' || s.browserMode !== 'sessions')) {
                openSessionBrowser('load', false);
                return;
            }
            if (s.view === 'browser' && s.browserMode === 'sessions') {
                if (s.shiftHeld) renameSelectedSessionToCurrentName();
                else browserSelect();
            } else if (s.shiftHeld) {
                openSessionBrowser('load', false);
            } else {
                cycleAssignMode();
            }
            return;
        }

        if (cc === MoveCopy) {
            if (val > 0) {
                s.copyHeld = true;
                s.copyPressTick = s.transportTicks;
                s.copyConsumed = false;
            } else {
                const heldTicks = s.copyPressTick < 0 ? 9999 : (s.transportTicks - s.copyPressTick);
                const quickTap = heldTicks >= 0 && heldTicks <= COPY_TAP_MAX_TICKS;
                const allowVelocityToggle = quickTap &&
                    !s.copyConsumed &&
                    s.view === 'main' &&
                    !s.shiftHeld &&
                    !s.volumeTouchHeld;
                s.copyHeld = false;
                s.copyPressTick = -1;
                s.copyConsumed = false;
                if (allowVelocityToggle) toggleVelocitySens();
                return;
            }
            if (s.view === 'main' && s.shiftHeld && s.volumeTouchHeld) {
                randomizeFocusedTransientSlices();
                return;
            }
            if (s.shiftHeld && (s.view !== 'browser' || s.browserMode !== 'sessions')) {
                openSessionBrowser('save', true);
                return;
            }
            if (s.view === 'browser' && s.browserMode === 'sessions') {
                if (s.shiftHeld && s.volumeTouchHeld) copySelectedSessionToAutoName();
                else if (s.shiftHeld) saveSessionNamed(false);
                else if (s.sessionBrowserIntent === 'save') saveSessionNamed(false);
                else setSessionNameFromSelected();
            } else if (s.shiftHeld) {
                openSessionBrowser('save', true);
            }
            return;
        }

        if (cc === MoveCapture && val > 0) {
            if (s.view === 'main') randomizeFocusedTransientSlices();
            return;
        }

        if ((cc === MoveArrowRight || cc === MoveArrowLeft) && val > 0) {
            if (s.view === 'main' && s.loopPadMode) {
                shiftLooperPadWindow(cc === MoveArrowRight ? 1 : -1);
                return;
            }
        }

        if (cc === MoveArrowUp && val > 0) {
            if (s.view === 'main') {
                s.view = 'fx';
                s.fxScreenScope = 'bank';
                showStatus('FX screen', 70);
                updateUtilityButtonLeds();
                markLedsDirty();
                s.dirty = true;
            }
            return;
        }

        if (cc === MoveArrowDown && val > 0) {
            if (s.view === 'fx') {
                s.view = 'main';
                showStatus('Main screen', 70);
                updateUtilityButtonLeds();
                markLedsDirty();
                s.dirty = true;
            }
            return;
        }

        if (cc === MoveMainKnob) {
            handleMainKnob(decodeDelta(val));
            return;
        }

        if (cc === MoveMainButton && val > 0) {
            handleMainButtonPress();
            return;
        }

        handleParamKnob(cc, decodeDelta(val));
    } finally {
        endHistoryTransaction();
    }
}

function onMidiMessageExternal(data) {
    handleMidiIn(data);
}

function init() {
    /* Always hard-reset grid LEDs on entry to avoid stale state from previous modules. */
    clearPadAndStepLeds();
    s.ledQueue = [];
    s.ledsDirty = true;
    s.activePadPress = {};
    s.binaryKnobState = {};
    s.padPressFlash = {};
    s.sections = [
        makeSection(MODE_SINGLE),
        makeSection(MODE_PER_SLOT)
    ];

    initFromDspDefaults();
    /*
     * Prevent stale DSP effect toggles from previous module instances/sessions.
     * We force all known bank/global FX lanes off before restoring serialized state.
     */
    for (let dspFx = 0; dspFx < DSP_FX_COUNT; dspFx++) {
        sp('performance_fx_global_toggle', dspFx + ':0');
        sp('pfx_global_toggle', dspFx + ':0');
        for (let sec = 0; sec < GRID_COUNT; sec++) {
            for (let bank = 0; bank < BANK_COUNT; bank++) {
                const payload = sec + ':' + bank + ':' + dspFx + ':0';
                sp('performance_fx_bank_toggle', payload);
                sp('pfx_bank_toggle', payload);
            }
        }
    }
    activateStandaloneMidiPort();
    s.copySource = null;
    s.copyHeld = false;
    s.copyPressTick = -1;
    s.copyConsumed = false;
    s.deleteHeld = false;
    s.stepFxHold = null;
    s.startTrimSoundingEnabled = true;
    s.sessionBrowserIntent = 'load';
    s.sessionName = sanitizeSessionName(s.sessionName);
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    ensureInitSessionFile(false);

    const restoredFromSession =
        loadSessionFromPath(autosavePath(), true, false) ||
        loadSessionFromPath(sessionPathFromName(s.sessionName), true, false) ||
        loadLegacySession(true) ||
        loadSessionFromPath(sessionPathFromName(INIT_SESSION_NAME), true, false);

    if (!restoredFromSession) {
        applyAllStateToDsp();
    }

    s.velocitySens = 0;
    spb('velocity_sens', '0', 120);

    s.view = 'main';
    s.muteHeld = false;
    s.transportTicks = 0;
    if (!restoredFromSession) {
        s.loopPadMode = false;
        s.activeLooper = 0;
        s.loopPadPage = 0;
        s.loopPadSection = 1;
        s.loopPadFullGrid = false;
    } else {
        s.activeLooper = clampInt(s.activeLooper, 0, s.midiLoopers.length - 1, 0);
        s.loopPadPage = clampInt(s.loopPadPage, 0, Math.max(0, Math.floor((s.midiLoopers.length - 1) / LOOPER_PAGE_SIZE)), 0);
        s.loopPadSection = clampInt(s.loopPadSection, 0, GRID_COUNT - 1, 1);
        s.loopPadFullGrid = !!s.loopPadFullGrid;
    }
    for (const k in activeVoicesByAddr) delete activeVoicesByAddr[k];
    for (const k in pendingNoteOffsByAddr) delete pendingNoteOffsByAddr[k];
    if (!Array.isArray(s.midiLoopers) || s.midiLoopers.length !== LOOPER_COUNT) {
        s.midiLoopers = Array.from({ length: LOOPER_COUNT }, () => createLooperState());
    }
    for (let i = 0; i < s.midiLoopers.length; i++) {
        const l = s.midiLoopers[i];
        if (!l) continue;
        l.buttonHeld = false;
        l.buttonDownTick = -1;
        l.lastPressTick = -9999;
        l.eraseHoldTriggered = false;
        l.holdEraseArmed = false;
        l.playStartMs = looperNowMs();
        l.loopPosMs = 0;
        l.lastLoopPosMs = 0;
    }
    s.autosavePending = false;
    s.autosaveTicks = 0;
    s.focusedParamRefreshTicks = 0;
    s.trimReplayTicks = 0;
    s.trimReplayPendingAll = false;
    resetHistory();
    previewStop();
    updateRecordButtonLed();
    forceLedRefreshNow();
    s.ledResyncPasses = LED_RESYNC_PASSES;
    s.ledResyncTicks = LED_RESYNC_INTERVAL_TICKS;
    s.dirty = true;
}

function tick() {
    s.transportTicks++;
    syncFromDsp();
    tickStatusTimer();
    tickAutosave();
    previewTick();
    tickStepFxHold();
    tickMidiLooperButtonHold();
    tickMidiLooperPlayback();
    tickPadPressFlash();
    tickMidiEchoCache();
    syncPerfFxLoopLength();
    flushPendingNoteOffs();
    tickLedResync();
    drainLedQueue();

    if (!s.dirty) return;
    s.dirty = false;
    draw();
}

function beforeExit() {
    const keys = Object.keys(activeVoicesByAddr);
    for (let i = 0; i < keys.length; i++) {
        const v = activeVoicesByAddr[keys[i]];
        if (!v) continue;
        emitPadNoteOffNow(v.sec, v.bank, v.slot, !!v.routeBank, false);
    }
    previewStop();
    setRecordMonitorEnabled(false);
    s.ledResyncPasses = 0;
    s.ledResyncTicks = 0;
    setButtonLED(MoveRec, Black, true);
    setButtonLED(MoveRecord, Black, true);
    saveAutosaveSession(true);
}

const twinsamplerChainUi = {
    __moduleId: 'twinsampler_overtake',
    beforeExit,
    init,
    tick,
    onMidiMessageInternal,
    onMidiMessageExternal,
};

/* Publish only module-unique namespace to avoid cross-module global collisions. */
globalThis.twinsampler_chain_ui = twinsamplerChainUi;
