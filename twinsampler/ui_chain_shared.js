import * as moveConstants from '/data/UserData/schwung/shared/constants.mjs';
import * as moveInputFilter from '/data/UserData/schwung/shared/input_filter.mjs';

function pickConst(name, fallback) {
    const v = moveConstants[name];
    return Number.isFinite(v) ? v : fallback;
}

export const MoveMainKnob = pickConst('MoveMainKnob', 14);
export const MoveMainButton = pickConst('MoveMainButton', 3);
export const MoveKnob1 = pickConst('MoveKnob1', 71);
export const MoveKnob2 = pickConst('MoveKnob2', 72);
export const MoveKnob3 = pickConst('MoveKnob3', 73);
export const MoveKnob4 = pickConst('MoveKnob4', 74);
export const MoveKnob5 = pickConst('MoveKnob5', 75);
export const MoveKnob6 = pickConst('MoveKnob6', 76);
export const MoveKnob7 = pickConst('MoveKnob7', 77);
export const MoveKnob8 = pickConst('MoveKnob8', 78);
export const MoveShift = pickConst('MoveShift', 49);
export const MoveMenu = pickConst('MoveMenu', 50);
export const MoveCopy = pickConst('MoveCopy', 60);
export const MoveCapture = pickConst('MoveCapture', 52);
export const MoveRec = pickConst('MoveRec', 86);
export const MoveRecord = pickConst('MoveRecord', 118);
export const MoveLoop = pickConst('MoveLoop', 87);
export const MoveMute = pickConst('MoveMute', 88);
export const MoveUndo = pickConst('MoveUndo', 56);
export const MoveDelete = pickConst('MoveDelete', 119);
export const MoveMaster = pickConst('MoveMaster', 79);
export const MoveMasterTouch = pickConst('MoveMasterTouch', 8);
export const Black = pickConst('Black', 0);
export const BrightRed = pickConst('BrightRed', 127);

export const decodeDelta = (typeof moveInputFilter.decodeDelta === 'function')
    ? moveInputFilter.decodeDelta
    : function(value) {
        if (value === 0) return 0;
        if (value >= 1 && value <= 63) return 1;
        if (value >= 65 && value <= 127) return -1;
        return 0;
    };

export const setLED = (typeof moveInputFilter.setLED === 'function')
    ? moveInputFilter.setLED
    : function(note, color) {
        try {
            if (typeof move_midi_internal_send === 'function') {
                move_midi_internal_send([0x09, 0x90, note, color]);
            }
        } catch (e) {}
    };

export const setButtonLED = (typeof moveInputFilter.setButtonLED === 'function')
    ? moveInputFilter.setButtonLED
    : function(cc, color) {
        try {
            if (typeof move_midi_internal_send === 'function') {
                move_midi_internal_send([0x0B, 0xB0, cc, color]);
            }
        } catch (e) {}
    };

export const USE_STEP_BANKS = true; /* overtake: step buttons select banks */
export const LEFT_GRID_ONLY = false; /* dual-grid mode: left and right 4x4 sections active */
export const MODULE_FLAVOR = '';

export const SAMPLES_DIR = '/data/UserData/UserLibrary/Samples';
export const RECORDED_SAMPLES_ROOT = SAMPLES_DIR + '/TwinSamplerRecorded';
export const SESSIONS_DIR = '/data/UserData/UserLibrary/TwinSamplerSessions';
export const LEGACY_SESSION_FILE = '/data/UserData/UserLibrary/twinsampler-session-v2.json';
export const AUTOSAVE_SESSION_FILE = '/data/UserData/UserLibrary/twinsampler-autosave-v1.json';
export const DEFAULT_SESSION_NAME = 'SESSION01';
export const INIT_SESSION_NAME = 'INIT';
export const SESSION_NAME_MAX = 12;
export const SESSION_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
export const AUTOSAVE_DELAY_TICKS = 96;
export const REALTIME_NONBLOCKING = true;
export const HISTORY_MAX = 80;

export const GRID_SIZE = 16;
export const GRID_COUNT = 2;
export const BANK_COUNT = 8;
export const TOTAL_PADS = GRID_SIZE * GRID_COUNT;
export const MIDI_NOTE_BASE = 36; /* C1 in Drum Rack convention */
export const MIDI_FIXED_NOTES = Array.from({ length: GRID_SIZE }, (_, i) => MIDI_NOTE_BASE + i);
export const MIDI_OUT_POLY_AFTERTOUCH = false;

export const PAD_NOTE_MIN = 68;
export const PAD_NOTE_MAX = 99;
export const PAD_COLS = 8;
export const PAD_ROWS = 4;
export const SECTION_COLS = 4;
export const STEP_NOTE_MIN = 16;
export const STEP_NOTE_MAX = 31;

export const MODE_SINGLE = 0;
export const MODE_PER_SLOT = 1;
export const SOURCE_CHOP_COUNT = 16;
export const CHOP_OPTIONS = [SOURCE_CHOP_COUNT];

export const LOOP_LABELS = ['Off', 'Loop', 'Ping'];
export const STATUS_TICKS = 120;
export const LEDS_PER_TICK = 8;
export const PREVIEW_DEBOUNCE_MS = 250;
export const SOURCE_PITCH_LIVE_RETRIGGER = true;
export const RECORD_LED_BLINK_PERIOD_TICKS = 24;
export const LED_RESYNC_INTERVAL_TICKS = 18;
export const LED_RESYNC_PASSES = 3;
export const LOOP_DOUBLE_PRESS_TICKS = 90;
export const LOOP_ERASE_HOLD_TICKS = 36;
export const PAD_PRESS_FLASH_TICKS = 5;
export const PAD_PRESS_LED_COLOR = 122; /* dim white */
export const RECORD_ACK_TIMEOUT_TICKS = 72;
export const RECORD_INTENT_WINDOW_TICKS = 48;
export const MIDI_ECHO_SUPPRESS_WINDOW_MS = 35;
export const MIDI_MIN_NOTE_LENGTH_MS = 8;
export const MIDI_DUPLICATE_NOTE_ON_GUARD_MS = 2;
export const LOOP_PAD_NOTES = [96, 97, 98, 99]; /* top row, right 4 pads */
export const LOOP_PAD_COLOR_OFF = Black;
export const LOOP_PAD_COLOR_RECORD = BrightRed;
export const LOOP_PAD_COLOR_PLAY = 21;
export const LOOP_PAD_COLOR_OVERDUB = 9;
export const LOOP_PAD_COLOR_STOPPED = 118;
export const TRIM_STEP_FINE = 1.0;
export const TRIM_STEP_COARSE = 5.0;

export function createLooperState() {
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

export const BANK_COLOR_SEQUENCE = [8, 15, 3, 21, 7, 31, 47, 1];
export const COLOR_PALETTE = [120, 118, 8, 9, 11, 12, 14, 15, 16, 47, 48, 3, 7, 21, 1, 125, 127];
export const PAD_COLOR_SEQUENCE = [-1].concat(COLOR_PALETTE);

export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

export function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
}

export function clampFloat(v, min, max, fallback) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
}

export function normalizeChopCount(v) {
    void v;
    return SOURCE_CHOP_COUNT;
}

export function normalizeTransientSensitivity(v) {
    return clampInt(v, 0, 100, 50);
}

export function chopIndex(v) {
    const c = normalizeChopCount(v);
    const i = CHOP_OPTIONS.indexOf(c);
    return i >= 0 ? i : 2;
}

export function baseName(path) {
    if (!path) return '';
    const parts = String(path).split('/');
    return parts[parts.length - 1] || '';
}

export function shortText(text, max = 21) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)) + '...';
}

export function sectionFromSlice(slice) {
    return slice < GRID_SIZE ? 0 : 1;
}

export function slotFromSlice(slice) {
    return slice % GRID_SIZE;
}

export function sliceFromPadNote(note) {
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

export function playableSliceFromPadNote(note) {
    /* Keep pad routing deterministic: never remap to legacy coordinates. */
    return sliceFromPadNote(note);
}

export function dspSliceFromSecSlot(sec, slot) {
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const sSlot = clampInt(slot, 0, GRID_SIZE - 1, 0);
    return sSec * GRID_SIZE + sSlot;
}

export function dspSliceFromCustomSlice(slice) {
    const sec = sectionFromSlice(slice);
    const slot = slotFromSlice(slice);
    return dspSliceFromSecSlot(sec, slot);
}

export function customSliceFromDspSlice(dspSlice) {
    return clampInt(dspSlice, 0, TOTAL_PADS - 1, 0);
}

export function defaultBankColor(bankIdx) {
    return BANK_COLOR_SEQUENCE[clampInt(bankIdx, 0, BANK_COUNT - 1, 0) % BANK_COLOR_SEQUENCE.length];
}

export function makeSlot() {
    return {
        path: '',
        attack: 5.0,
        decay: 500.0,
        startTrim: 0.0,
        endTrim: 0.0,
        gain: 1.0,
        pitch: 0.0,
        modeGate: 0,
        loop: 0,
        color: -1,
        muted: 0
    };
}

export function cloneSlot(s) {
    return {
        path: s.path,
        attack: s.attack,
        decay: s.decay,
        startTrim: s.startTrim,
        endTrim: s.endTrim,
        gain: s.gain,
        pitch: s.pitch,
        modeGate: s.modeGate,
        loop: s.loop,
        color: s.color,
        muted: s.muted ? 1 : 0
    };
}

export function makeBank(bankIdx = 0) {
    const slots = [];
    for (let i = 0; i < GRID_SIZE; i++) slots.push(makeSlot());
    return {
        sourcePath: '',
        bankColor: defaultBankColor(bankIdx),
        chopCount: SOURCE_CHOP_COUNT,
        slicePage: 0,
        transientSensitivity: 50,
        sliceStarts: [],
        slots
    };
}

export function cloneBank(b) {
    return {
        sourcePath: b.sourcePath,
        bankColor: b.bankColor,
        chopCount: normalizeChopCount(b.chopCount),
        slicePage: clampInt(b.slicePage, 0, 7, 0),
        transientSensitivity: normalizeTransientSensitivity(b.transientSensitivity),
        sliceStarts: Array.isArray(b.sliceStarts) ? b.sliceStarts.map((v) => clampInt(v, 0, 0x7fffffff, 0)) : [],
        slots: b.slots.map((s) => cloneSlot(s))
    };
}

export function makeSection(defaultMode) {
    const banks = [];
    for (let i = 0; i < BANK_COUNT; i++) banks.push(makeBank(i));
    return {
        mode: defaultMode,
        currentBank: 0,
        banks
    };
}

export function createInitialState() {
    return {
        view: 'main',
        dirty: true,

        shiftHeld: false,
        volumeTouchHeld: false,
        knobPage: 'A',
        editScope: 'P', /* P=pad slot, G=focused section+bank */

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
        lastRecordedPath: '',

        browserPath: SAMPLES_DIR,
        browserEntries: [],
        browserCursor: 0,
        browserScroll: 0,
        browserMode: 'samples', /* samples|sessions */
        sessionBrowserIntent: 'load', /* load|save */
        browserAssignMode: 'auto', /* auto|slot|source */
        previewPendingPath: '',
        previewPendingAt: 0,
        previewCurrentPath: '',
        sessionName: DEFAULT_SESSION_NAME,
        sessionCharIndex: 0,

        copySource: null,
        stepCopySource: null,
        activePadPress: {},
        muteHeld: false,
        lastPadTriggerTick: -9999,
        midiEchoSuppression: true,
        recentOutboundMidi: {},

        transportTicks: 0,
        padPressFlash: {},
        midiLoopers: [createLooperState(), createLooperState(), createLooperState(), createLooperState()],
        activeLooper: 0,
        loopPadMode: false,

        statusText: '',
        statusTicks: 0,
        ledsDirty: true,
        ledQueue: [],
        ledResyncTicks: 0,
        ledResyncPasses: 0,

        autosavePending: false,
        autosaveTicks: 0,

        undoHistory: [],
        redoHistory: [],
        historyTxnDepth: 0,
        historyTxnDirty: false,
        historyApplying: false,
    };
}
