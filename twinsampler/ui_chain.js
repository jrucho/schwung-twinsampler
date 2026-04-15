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
const MoveMute = pickConst('MoveMute', 88);
const MoveUndo = pickConst('MoveUndo', 56);
const MoveDelete = pickConst('MoveDelete', 119);
const MoveMaster = pickConst('MoveMaster', 79);
const MoveMasterTouch = pickConst('MoveMasterTouch', 8);
const Black = pickConst('Black', 0);
const BrightRed = pickConst('BrightRed', 127);

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
const STATUS_TICKS = 120;
const LEDS_PER_TICK = 8;
const PREVIEW_DEBOUNCE_MS = 250;
const SOURCE_PITCH_LIVE_RETRIGGER = true;
const RECORD_LED_BLINK_PERIOD_TICKS = 24;
const LED_RESYNC_INTERVAL_TICKS = 18;
const LED_RESYNC_PASSES = 3;
const LOOP_DOUBLE_PRESS_TICKS = 90;
const LOOP_ERASE_HOLD_TICKS = 36;
const PAD_PRESS_FLASH_TICKS = 5;
const PAD_PRESS_LED_COLOR = 122; /* dim white */
const RECORD_ACK_TIMEOUT_TICKS = 72;
const RECORD_INTENT_WINDOW_TICKS = 48;
const INPUT_CLIP_WARN_THRESHOLD = 0.985;
const MIDI_ECHO_SUPPRESS_WINDOW_MS = 35;
const MIDI_MIN_NOTE_LENGTH_MS = 8;
const MIDI_DUPLICATE_NOTE_ON_GUARD_MS = 2;
const LOOP_PAD_NOTES = [96, 97, 98, 99]; /* top row, right 4 pads */
const LOOP_PAD_COLOR_OFF = Black;
const LOOP_PAD_COLOR_RECORD = BrightRed;
const LOOP_PAD_COLOR_PLAY = 21;
const LOOP_PAD_COLOR_OVERDUB = 9;
const LOOP_PAD_COLOR_STOPPED = 118;
const TRIM_STEP_FINE = 1.0;
const TRIM_STEP_COARSE = 5.0;
const SAMPLER_EMU_MODE_LABELS = ['Clean', 'Crunch 12', 'Punch 16', 'Dusty 26', 'Vintage 26'];
const SAMPLER_EMU_RATE_OPTIONS = [8000, 11025, 16000, 22050, 26040, 32000, 40000, 44100];

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

function cloneSlot(s) {
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

function makeBank(bankIdx = 0) {
    const slots = [];
    for (let i = 0; i < GRID_SIZE; i++) slots.push(makeSlot());
    return {
        sourcePath: '',
        bankColor: defaultBankColor(bankIdx),
        chopCount: SOURCE_CHOP_COUNT,
        slicePage: 0,
        transientSensitivity: 50,
        samplerEmuMode: 0,
        samplerEmuBitDepth: 16,
        samplerEmuRateHz: 44100,
        samplerEmuDrivePct: 100,
        samplerEmuNoisePct: 0,
        samplerEmuTonePct: 80,
        samplerEmuWetPct: 100,
        samplerEmuCompPct: 30,
        sliceStarts: [],
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
        samplerEmuMode: clampInt(b.samplerEmuMode, 0, 4, 0),
        samplerEmuBitDepth: clampInt(b.samplerEmuBitDepth, 4, 16, 16),
        samplerEmuRateHz: clampInt(b.samplerEmuRateHz, 2000, 96000, 44100),
        samplerEmuDrivePct: clampInt(b.samplerEmuDrivePct, 25, 400, 100),
        samplerEmuNoisePct: clampInt(b.samplerEmuNoisePct, 0, 100, 0),
        samplerEmuTonePct: clampInt(b.samplerEmuTonePct, 2, 100, 80),
        samplerEmuWetPct: clampInt(b.samplerEmuWetPct, 0, 100, 100),
        samplerEmuCompPct: clampInt(b.samplerEmuCompPct, 0, 100, 30),
        sliceStarts: Array.isArray(b.sliceStarts) ? b.sliceStarts.map((v) => clampInt(v, 0, 0x7fffffff, 0)) : [],
        slots: b.slots.map((s) => cloneSlot(s))
    };
}

function makeSection(defaultMode) {
    const banks = [];
    for (let i = 0; i < BANK_COUNT; i++) banks.push(makeBank(i));
    return {
        mode: defaultMode,
        currentBank: 0,
        banks
    };
}

const s = {
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
    recInputGainPct: 100,
    recSchwungGainPct: 100,
    captureInputPeak: 0.0,
    captureBusPeak: 0.0,
    clipWarnTicks: 0,
    samplerEmuMode: 0,
    samplerEmuBitDepth: 16,
    samplerEmuRateHz: 44100,
    samplerEmuDrivePct: 100,
    samplerEmuNoisePct: 0,
    samplerEmuTonePct: 80,
    samplerEmuWetPct: 100,
    samplerEmuCompPct: 30,
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
    masterKnobLast: -1,
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
        midiLoopers: [createLooperState(), createLooperState(), createLooperState(), createLooperState()],
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
    if (starts.length === count + 1) b.sliceStarts = starts;
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
    loadSamplerEmuFromBank(s.focusedSection);
    pushSamplerEmuParams();
    const dspSlice = dspSliceFromCustomSlice(slice);

    const send = (blocking || !REALTIME_NONBLOCKING) ? spb : sp;
    send('selected_slice', String(dspSlice), 100);
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
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_end_trim', sl.endTrim.toFixed(2), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_gain', sl.gain.toFixed(3), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_pitch', sl.pitch.toFixed(2), 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_mode', sl.modeGate, 120);
    sendDirectSlotParamCompat(sec, bank, slot, 'slot_loop', sl.loop, 120);

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
    const idx = clampInt(s.activeLooper, 0, 3, 0);
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
    return LOOP_PAD_NOTES.indexOf(note);
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

function browserOpen(path, mode) {
    s.browserMode = (mode === 'sessions') ? 'sessions' : 'samples';
    s.browserPath = (s.browserMode === 'sessions') ? SESSIONS_DIR : (path || SAMPLES_DIR);
    s.browserCursor = 0;
    s.browserScroll = 0;
    s.browserEntries = (s.browserMode === 'sessions') ? listSessionEntries() : listSampleEntries(s.browserPath);

    if (s.browserMode === 'sessions' && !s.sessionBrowserIntent) s.sessionBrowserIntent = 'load';

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
    if (s.browserCursor < s.browserScroll) s.browserScroll = s.browserCursor;
    else if (s.browserCursor >= s.browserScroll + 4) s.browserScroll = s.browserCursor - 3;
}

function browserScrollBy(delta) {
    const maxIdx = Math.max(0, s.browserEntries.length - 1);
    s.browserCursor = clamp(s.browserCursor + delta, 0, maxIdx);

    if (s.browserCursor < s.browserScroll) s.browserScroll = s.browserCursor;
    else if (s.browserCursor >= s.browserScroll + 4) s.browserScroll = s.browserCursor - 3;

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
    sb.sourcePath = String(path || '');
    sb.chopCount = SOURCE_CHOP_COUNT;
    sb.slicePage = 0;
    if (sendToDsp) {
        spb('section_source_play_mode', sec + ':' + bank + ':' + sourcePlayModeForSection(sec), 300);
        spb('section_chop_count', sec + ':' + bank + ':' + SOURCE_CHOP_COUNT, 300);
        spb('section_slice_page', sec + ':' + bank + ':0', 300);
        spb('section_source_path', sec + ':' + bank + ':' + sb.sourcePath, 500);
        spb('section_randomize_transients', sec + ':' + bank + ':1', 500);
        syncBankSliceState(sec, bank);
    }
    markSessionChanged();
}

function setSlotPath(sec, bank, slot, path, sendToDsp) {
    const sl = s.sections[sec].banks[bank].slots[slot];
    sl.path = String(path || '');
    if (!sendToDsp) {
        markSessionChanged();
        return;
    }

    if (sl.path) spb('slot_sample_path', sec + ':' + bank + ':' + slot + ':' + sl.path, 500);
    else spb('clear_slot_sample', sec + ':' + bank + ':' + slot, 500);
    if (sec === s.focusedSection && bank === focusedBankIndex(sec) && slot === focusedSlotIndex()) {
        invalidatePlaybackCompat();
        syncFocusedSlotPlaybackCompat(true);
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
        browserOpen(e.path, 'samples');
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
    if (sec === s.focusedSection) {
        loadSamplerEmuFromBank(sec);
        pushSamplerEmuParams();
    }

    if (sec === s.focusedSection) {
        refreshRealtimeUiState();
    }

    showStatus('S' + (sec + 1) + ' bank ' + (b + 1), 70);
    markLedsDirty();
    markSessionChanged();
    s.dirty = true;
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
    if (slotKey === 'slot_end_trim') return 'slice_end_trim';
    if (slotKey === 'slot_gain') return 'slice_gain';
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

function setSlotAttack(sec, bank, slot, value) {
    const v = clampFloat(value, 1.0, 5000.0, 5.0);
    slotAt(sec, bank, slot).attack = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_attack_at', 'slot_attack', v.toFixed(2), 180);
    markSessionChanged();
}

function setSlotDecay(sec, bank, slot, value) {
    const v = clampFloat(value, 1.0, 10000.0, 500.0);
    slotAt(sec, bank, slot).decay = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_decay_at', 'slot_decay', v.toFixed(2), 180);
    markSessionChanged();
}

function setSlotStartTrim(sec, bank, slot, value) {
    const v = clampFloat(value, -5000.0, 5000.0, 0.0);
    slotAt(sec, bank, slot).startTrim = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_start_trim_at', 'slot_start_trim', v.toFixed(2), 180);
    markSessionChanged();
}

function setSlotEndTrim(sec, bank, slot, value) {
    const v = clampFloat(value, -5000.0, 5000.0, 0.0);
    slotAt(sec, bank, slot).endTrim = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_end_trim_at', 'slot_end_trim', v.toFixed(2), 180);
    markSessionChanged();
}

function setSlotGain(sec, bank, slot, value) {
    const v = clampFloat(value, 0.0, 4.0, 1.0);
    slotAt(sec, bank, slot).gain = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_gain_at', 'slot_gain', v.toFixed(3), 180);
    markSessionChanged();
}

function setSlotPitch(sec, bank, slot, value) {
    const v = clampFloat(value, -48.0, 48.0, 0.0);
    slotAt(sec, bank, slot).pitch = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_pitch_at', 'slot_pitch', v.toFixed(2), 180, true);
    markSessionChanged();
}

function setSlotMode(sec, bank, slot, modeGate) {
    const v = clampInt(modeGate, 0, 1, 1);
    slotAt(sec, bank, slot).modeGate = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_mode_at', 'slot_mode', v, 180);
    markSessionChanged();
}

function setSlotLoop(sec, bank, slot, loopMode) {
    const v = clampInt(loopMode, 0, 2, 0);
    slotAt(sec, bank, slot).loop = v;
    sendSlotParamCompat(sec, bank, slot, 'slot_loop_at', 'slot_loop', v, 180);
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
    dst.decay = clampFloat(srcSlot.decay, 1.0, 10000.0, 500.0);
    dst.startTrim = clampFloat(srcSlot.startTrim, -5000.0, 5000.0, 0.0);
    dst.endTrim = clampFloat(srcSlot.endTrim, -5000.0, 5000.0, 0.0);
    dst.gain = clampFloat(srcSlot.gain, 0.0, 4.0, 1.0);
    dst.pitch = clampFloat(srcSlot.pitch, -48.0, 48.0, 0.0);
    dst.modeGate = clampInt(srcSlot.modeGate, 0, 1, 1);
    dst.loop = clampInt(srcSlot.loop, 0, 2, 0);
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

function sendSlotStateToDsp(sec, bank, slot, blocking) {
    const sl = slotAt(sec, bank, slot);
    const send = blocking ? spb : sp;
    const timeout = blocking ? 250 : 0;

    if (sl.path) send('slot_sample_path', sec + ':' + bank + ':' + slot + ':' + sl.path, timeout);
    else send('clear_slot_sample', sec + ':' + bank + ':' + slot, timeout);

    send('slot_attack_at', fmtAt(sec, bank, slot, sl.attack.toFixed(2)), timeout);
    send('slot_decay_at', fmtAt(sec, bank, slot, sl.decay.toFixed(2)), timeout);
    send('slot_start_trim_at', fmtAt(sec, bank, slot, sl.startTrim.toFixed(2)), timeout);
    send('slot_end_trim_at', fmtAt(sec, bank, slot, sl.endTrim.toFixed(2)), timeout);
    send('slot_gain_at', fmtAt(sec, bank, slot, sl.gain.toFixed(3)), timeout);
    send('slot_pitch_at', fmtAt(sec, bank, slot, sl.pitch.toFixed(2)), timeout);
    send('slot_mode_at', fmtAt(sec, bank, slot, sl.modeGate), timeout);
    send('slot_loop_at', fmtAt(sec, bank, slot, sl.loop), timeout);

    if (sec === s.focusedSection && bank === focusedBankIndex(sec) && slot === focusedSlotIndex()) {
        const directTimeout = blocking ? 180 : 120;
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_attack', sl.attack.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_decay', sl.decay.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_start_trim', sl.startTrim.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_end_trim', sl.endTrim.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_gain', sl.gain.toFixed(3), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_pitch', sl.pitch.toFixed(2), directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_mode', sl.modeGate, directTimeout, !!blocking);
        sendDirectSlotParamCompat(sec, bank, slot, 'slot_loop', sl.loop, directTimeout, !!blocking);
    }
}

function applyBankStateToDsp(sec, bank, blockingSlots) {
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
        sendSlotStateToDsp(sec, bank, slot, !!blockingSlots);
    }
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
    }

    s.ledsDirty = false;
}

function drainLedQueue() {
    if (s.ledsDirty) rebuildLedQueue();
    if (!s.ledQueue.length) return;

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

function adjustPadDecay(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).decay + delta * 20.0;
    setSlotDecay(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' Dec ' + Math.round(slotAt(a.sec, a.bank, a.slot).decay), 80);
    s.dirty = true;
}

function adjustPadStartTrim(delta) {
    const a = focusedAddr();
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    const v = slotAt(a.sec, a.bank, a.slot).startTrim + delta * step;
    setSlotStartTrim(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' Start ' + Math.round(slotAt(a.sec, a.bank, a.slot).startTrim), 80);
    s.dirty = true;
}

function adjustPadEndTrim(delta) {
    const a = focusedAddr();
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    const v = slotAt(a.sec, a.bank, a.slot).endTrim + delta * step;
    setSlotEndTrim(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' End ' + Math.round(slotAt(a.sec, a.bank, a.slot).endTrim), 80);
    s.dirty = true;
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
    retriggerHeldFocusedSourcePadForPitch();
    showStatus('P' + (a.slot + 1) + ' Pitch ' + slotAt(a.sec, a.bank, a.slot).pitch.toFixed(1), 80);
    s.dirty = true;
}

function adjustPadGain(delta) {
    const a = focusedAddr();
    const v = slotAt(a.sec, a.bank, a.slot).gain + delta * 0.05;
    setSlotGain(a.sec, a.bank, a.slot, v);
    showStatus('P' + (a.slot + 1) + ' Gain x' + slotAt(a.sec, a.bank, a.slot).gain.toFixed(2), 80);
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

function adjustPadLoop(delta) {
    const a = focusedAddr();
    const cur = slotAt(a.sec, a.bank, a.slot).loop;
    const next = clamp(cur + (delta > 0 ? 1 : -1), 0, 2);
    setSlotLoop(a.sec, a.bank, a.slot, next);
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
    showStatus(s.velocitySens ? 'Velocity Sens ON' : 'Full Velocity ON', 80);
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
        setSlotAttack(sec, bank, slot, v);
    });
    showStatus('All atk ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).attack), 80);
}

function adjustAllDecay(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).decay + delta * 20.0;
        setSlotDecay(sec, bank, slot, v);
    });
    showStatus('All dec ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).decay), 80);
}

function adjustAllStartTrim(delta) {
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).startTrim + delta * step;
        setSlotStartTrim(sec, bank, slot, v);
    });
    showStatus('All start ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).startTrim), 80);
}

function adjustAllEndTrim(delta) {
    const step = s.shiftHeld ? TRIM_STEP_COARSE : TRIM_STEP_FINE;
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).endTrim + delta * step;
        setSlotEndTrim(sec, bank, slot, v);
    });
    showStatus('All end ' + Math.round(slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).endTrim), 80);
}

function toggleAllMode() {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    const first = slotAt(sec, bank, 0).modeGate;
    const next = first ? 0 : 1;
    forEachSlotInBank(sec, bank, (slot) => setSlotMode(sec, bank, slot, next));
    showStatus('All mode ' + (next ? 'Gate' : 'Trig'), 80);
    s.dirty = true;
}

function adjustAllLoop(delta) {
    const sec = s.focusedSection;
    const bank = focusedBankIndex(sec);
    forEachSlotInBank(sec, bank, (slot) => {
        const cur = slotAt(sec, bank, slot).loop;
        const next = clamp(cur + (delta > 0 ? 1 : -1), 0, 2);
        setSlotLoop(sec, bank, slot, next);
    });
    showStatus('All loop ' + LOOP_LABELS[slotAt(sec, bank, 0).loop], 80);
    s.dirty = true;
}

function adjustAllGain(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).gain + delta * 0.05;
        setSlotGain(sec, bank, slot, v);
    });
    showStatus('All gain x' + slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).gain.toFixed(2), 80);
}

function adjustFocusedBankPitch(delta) {
    applyAllSlotsInFocusedBank((sec, bank, slot) => {
        const v = slotAt(sec, bank, slot).pitch + delta * 0.5;
        setSlotPitch(sec, bank, slot, v);
    });
    retriggerHeldFocusedSourcePadForPitch();
    showStatus('Bank pitch ' + slotAt(s.focusedSection, focusedBankIndex(s.focusedSection), 0).pitch.toFixed(1), 80);
}

function adjustRecordMaxSeconds(delta) {
    s.recordMaxSeconds = clamp(s.recordMaxSeconds + delta, 1, 600);
    sp('record_max_seconds', String(s.recordMaxSeconds));
    showStatus('Record max ' + s.recordMaxSeconds + 's', 70);
    markSessionChanged();
    s.dirty = true;
}

function isRecordModeActive() {
    return s.recordArmed || s.recording || s.recordState === 'starting' || s.recordState === 'stopping';
}

function setRecordInputGainPct(nextPct) {
    s.recInputGainPct = clampInt(nextPct, 0, 100, s.recInputGainPct);
    sp('input_capture_gain', (s.recInputGainPct / 100).toFixed(3));
    showStatus('Rec line in ' + s.recInputGainPct + '%', 80);
    markSessionChanged();
    s.dirty = true;
}

function setRecordSchwungGainPct(nextPct) {
    s.recSchwungGainPct = clampInt(nextPct, 0, 100, s.recSchwungGainPct);
    sp('record_mix_gain', (s.recSchwungGainPct / 100).toFixed(3));
    pushSamplerEmuParams();
    showStatus('Rec schwung ' + s.recSchwungGainPct + '%', 80);
    markSessionChanged();
    s.dirty = true;
}

function adjustRecordCaptureGain(delta, target) {
    const step = delta > 0 ? 1 : -1;
    if (target === 'schwung') setRecordSchwungGainPct(s.recSchwungGainPct + step);
    else setRecordInputGainPct(s.recInputGainPct + step);
}

function focusedEmuBank(sec = s.focusedSection) {
    const safeSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const bank = focusedBankIndex(safeSec);
    return s.sections[safeSec].banks[bank];
}

function loadSamplerEmuFromBank(sec = s.focusedSection) {
    const b = focusedEmuBank(sec);
    s.samplerEmuMode = clampInt(b.samplerEmuMode, 0, 4, 0);
    s.samplerEmuBitDepth = clampInt(b.samplerEmuBitDepth, 4, 16, 16);
    s.samplerEmuRateHz = clampInt(b.samplerEmuRateHz, 2000, 96000, 44100);
    s.samplerEmuDrivePct = clampInt(b.samplerEmuDrivePct, 25, 400, 100);
    s.samplerEmuNoisePct = clampInt(b.samplerEmuNoisePct, 0, 100, 0);
    s.samplerEmuTonePct = clampInt(b.samplerEmuTonePct, 2, 100, 80);
    s.samplerEmuWetPct = clampInt(b.samplerEmuWetPct, 0, 100, 100);
    s.samplerEmuCompPct = clampInt(b.samplerEmuCompPct, 0, 100, 30);
}

function storeSamplerEmuToBank(sec = s.focusedSection) {
    const b = focusedEmuBank(sec);
    b.samplerEmuMode = clampInt(s.samplerEmuMode, 0, 4, 0);
    b.samplerEmuBitDepth = clampInt(s.samplerEmuBitDepth, 4, 16, 16);
    b.samplerEmuRateHz = clampInt(s.samplerEmuRateHz, 2000, 96000, 44100);
    b.samplerEmuDrivePct = clampInt(s.samplerEmuDrivePct, 25, 400, 100);
    b.samplerEmuNoisePct = clampInt(s.samplerEmuNoisePct, 0, 100, 0);
    b.samplerEmuTonePct = clampInt(s.samplerEmuTonePct, 2, 100, 80);
    b.samplerEmuWetPct = clampInt(s.samplerEmuWetPct, 0, 100, 100);
    b.samplerEmuCompPct = clampInt(s.samplerEmuCompPct, 0, 100, 30);
}

function pushSamplerEmuParams() {
    storeSamplerEmuToBank();
    sp('sampler_emu_mode', String(clampInt(s.samplerEmuMode, 0, 4, 0)));
    sp('sampler_emu_bit_depth', String(clampInt(s.samplerEmuBitDepth, 4, 16, 16)));
    sp('sampler_emu_resample_hz', String(clampInt(s.samplerEmuRateHz, 2000, 96000, 44100)));
    sp('sampler_emu_drive', (clampInt(s.samplerEmuDrivePct, 25, 400, 100) / 100).toFixed(3));
    sp('sampler_emu_noise', (clampInt(s.samplerEmuNoisePct, 0, 100, 0) / 100).toFixed(3));
    sp('sampler_emu_tone', (clampInt(s.samplerEmuTonePct, 2, 100, 80) / 100).toFixed(3));
    sp('sampler_emu_wet', (clampInt(s.samplerEmuWetPct, 0, 100, 100) / 100).toFixed(3));
    sp('sampler_emu_comp', (clampInt(s.samplerEmuCompPct, 0, 100, 30) / 100).toFixed(3));
}

function adjustSamplerEmuMode(delta) {
    s.samplerEmuMode = clampInt(s.samplerEmuMode + (delta > 0 ? 1 : -1), 0, SAMPLER_EMU_MODE_LABELS.length - 1, 0);
    pushSamplerEmuParams();
    showStatus('EMU ' + SAMPLER_EMU_MODE_LABELS[s.samplerEmuMode], 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustSamplerEmuBitDepth(delta) {
    s.samplerEmuBitDepth = clampInt(s.samplerEmuBitDepth + (delta > 0 ? 1 : -1), 4, 16, 16);
    pushSamplerEmuParams();
    showStatus('EMU bits ' + s.samplerEmuBitDepth, 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustSamplerEmuRate(delta) {
    const cur = clampInt(s.samplerEmuRateHz, 2000, 96000, 44100);
    let idx = SAMPLER_EMU_RATE_OPTIONS.indexOf(cur);
    if (idx < 0) {
        let best = 0;
        let bestDist = 1e9;
        for (let i = 0; i < SAMPLER_EMU_RATE_OPTIONS.length; i++) {
            const d = Math.abs(SAMPLER_EMU_RATE_OPTIONS[i] - cur);
            if (d < bestDist) {
                best = i;
                bestDist = d;
            }
        }
        idx = best;
    }
    idx = clampInt(idx + (delta > 0 ? 1 : -1), 0, SAMPLER_EMU_RATE_OPTIONS.length - 1, idx);
    s.samplerEmuRateHz = SAMPLER_EMU_RATE_OPTIONS[idx];
    pushSamplerEmuParams();
    showStatus('EMU rate ' + s.samplerEmuRateHz + 'Hz', 90);
    markSessionChanged();
    s.dirty = true;
}

function adjustSamplerEmuDrive(delta) {
    s.samplerEmuDrivePct = clampInt(s.samplerEmuDrivePct + (delta > 0 ? 5 : -5), 25, 400, 100);
    s.samplerEmuCompPct = clampInt(Math.round(s.samplerEmuDrivePct * 0.35), 0, 100, s.samplerEmuCompPct);
    pushSamplerEmuParams();
    showStatus('EMU drive ' + s.samplerEmuDrivePct + '% comp ' + s.samplerEmuCompPct + '%', 90);
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

function captureFocusedRecordTarget() {
    const a = focusedAddr();
    return { sec: a.sec, bank: a.bank, slot: a.slot };
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
    s.recTarget = a;
    s.recordLoadOnStop = false;
    s.recordArmed = true;
    setRecordState('starting');
    s.recordBlinkOn = true;
    s.recordBlinkTicks = 0;
    setRecordMonitorEnabled(true);

    sp('record_target', a.sec + ':' + a.bank + ':' + a.slot);
    sp('record_capture_mode', 'auto');
    sp('record_intent_internal', shouldPreferInternalCapture() ? '1' : '0');
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
    if (rec === s.recording) return;

    const prev = s.recording;
    s.recording = rec;

    if (prev === 1 && rec === 0) {
        const pathRaw = String(gp('last_recorded_path', '') || '');
        const path = ensureRecordedFileInDailyFolder(pathRaw);
        s.lastRecordedPath = path;
        const shouldLoad = !!s.recordLoadOnStop;
        s.recordLoadOnStop = false;
        s.recordArmed = false;
        setRecordState('idle');
        s.recordBlinkOn = false;
        s.recordBlinkTicks = 0;
        setRecordMonitorEnabled(false);

        if (path && shouldLoad) {
            const t = s.recTarget;
            const mode = s.sections[t.sec].mode;
            if (mode === MODE_SINGLE) {
                setSourcePath(t.sec, t.bank, path, true);
                syncBankSliceState(t.sec, t.bank);
                showStatus('Recorded+loaded SRC ' + recordTargetLabel(t), 110);
            } else {
                let slot = t.slot;
                const existing = slotAt(t.sec, t.bank, slot).path;
                if (existing && existing !== path) {
                    showStatus('Recorded overwrite ' + recordTargetLabel(t), 80);
                }
                setSlotPath(t.sec, t.bank, slot, path, true);
                showStatus('Recorded+loaded ' + recordTargetLabel({ sec: t.sec, bank: t.bank, slot }), 110);
            }
        } else if (path) {
            showStatus('Recorded: ' + shortText(baseName(path), 14), 90);
        } else {
            showStatus('Recording stopped', 80);
        }
    } else if (rec === 1) {
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

    if (isRecordModeActive()) {
        const inPct = String(s.recInputGainPct).padStart(3, ' ');
        const swPct = String(s.recSchwungGainPct).padStart(3, ' ');
        const inPk = Math.round(clampFloat(s.captureInputPeak, 0.0, 1.99, 0.0) * 100);
        const busPk = Math.round(clampFloat(s.captureBusPeak, 0.0, 1.99, 0.0) * 100);
        print(0, 40, shortText('IN:' + inPct + '% SW:' + swPct + '% P:' + inPk + '/' + busPk, 21), 1);
    } else if (s.knobPage === 'A') {
        if (s.editScope === 'P') {
            print(0, 40, shortText('A:' + Math.round(sl.attack) + ' D:' + Math.round(sl.decay) + ' S:' + Math.round(sl.startTrim) + ' E:' + Math.round(sl.endTrim), 21), 1);
        } else {
            print(0, 40, shortText('ALL: Atk/Dec/Trim', 21), 1);
        }
    } else {
        if (s.editScope === 'P') {
            const modeTxt = sl.modeGate ? 'Gate' : 'Trig';
            print(0, 40, shortText('M:' + modeTxt + ' P:' + sl.pitch.toFixed(1) + ' G:' + sl.gain.toFixed(2), 21), 1);
        } else {
            print(0, 40, shortText('Pitch:' + s.globalPitch.toFixed(1) + ' Gain:' + s.globalGain.toFixed(2) + ' Vel:' + (s.velocitySens ? 'On' : 'Off'), 21), 1);
        }
    }

    let footer = '';
    if (s.clipWarnTicks > 0) footer = 'CLIP! lower IN/SW gain';
    else if (s.statusTicks > 0) footer = s.statusText;
    else if (s.recording || s.recordState === 'starting' || s.recordState === 'stopping') {
        footer = 'REC->' + recordTargetLabel() + ' ' + s.recordState.toUpperCase();
    } else if (s.copySource) footer = 'Copy armed: tap dest pad';
    else footer = 'EMU:' + SAMPLER_EMU_MODE_LABELS[clampInt(s.samplerEmuMode, 0, 4, 0)] + ' Loop' + (s.activeLooper + 1);
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

function draw() {
    if (s.view === 'browser') {
        drawBrowser();
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
        globalGain: s.globalGain,
        globalPitch: s.globalPitch,
        velocitySens: s.velocitySens,
        recordMaxSeconds: s.recordMaxSeconds,
        recInputGainPct: s.recInputGainPct,
        recSchwungGainPct: s.recSchwungGainPct,
        samplerEmuMode: s.samplerEmuMode,
        samplerEmuBitDepth: s.samplerEmuBitDepth,
        samplerEmuRateHz: s.samplerEmuRateHz,
        samplerEmuDrivePct: s.samplerEmuDrivePct,
        samplerEmuNoisePct: s.samplerEmuNoisePct,
        samplerEmuTonePct: s.samplerEmuTonePct,
        samplerEmuWetPct: s.samplerEmuWetPct,
        samplerEmuCompPct: s.samplerEmuCompPct,
        activeLooper: clampInt(s.activeLooper, 0, 3, 0),
        loopPadMode: !!s.loopPadMode,
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
        decay: clampFloat(raw.decay, 1.0, 10000.0, base.decay),
        startTrim: clampFloat(raw.startTrim, -5000.0, 5000.0, base.startTrim),
        endTrim: clampFloat(raw.endTrim, -5000.0, 5000.0, base.endTrim),
        gain: clampFloat(raw.gain, 0.0, 4.0, base.gain),
        pitch: clampFloat(raw.pitch, -48.0, 48.0, base.pitch),
        modeGate: clampInt(raw.modeGate, 0, 1, base.modeGate),
        loop: clampInt(raw.loop, 0, 2, base.loop),
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
        samplerEmuMode: clampInt(raw.samplerEmuMode, 0, 4, base.samplerEmuMode),
        samplerEmuBitDepth: clampInt(raw.samplerEmuBitDepth, 4, 16, base.samplerEmuBitDepth),
        samplerEmuRateHz: clampInt(raw.samplerEmuRateHz, 2000, 96000, base.samplerEmuRateHz),
        samplerEmuDrivePct: clampInt(raw.samplerEmuDrivePct, 25, 400, base.samplerEmuDrivePct),
        samplerEmuNoisePct: clampInt(raw.samplerEmuNoisePct, 0, 100, base.samplerEmuNoisePct),
        samplerEmuTonePct: clampInt(raw.samplerEmuTonePct, 2, 100, base.samplerEmuTonePct),
        samplerEmuWetPct: clampInt(raw.samplerEmuWetPct, 0, 100, base.samplerEmuWetPct),
        samplerEmuCompPct: clampInt(raw.samplerEmuCompPct, 0, 100, base.samplerEmuCompPct),
        sliceStarts: parseSliceStartsString(Array.isArray(raw.sliceStarts) ? raw.sliceStarts.join(',') : raw.sliceStarts, chopCount),
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
    sp('global_gain', s.globalGain.toFixed(3));
    sp('global_pitch', s.globalPitch.toFixed(2));
    sp('velocity_sens', String(s.velocitySens));
    sp('record_max_seconds', String(s.recordMaxSeconds));
    sp('input_capture_gain', (clampInt(s.recInputGainPct, 0, 100, 100) / 100).toFixed(3));
    sp('record_mix_gain', (clampInt(s.recSchwungGainPct, 0, 100, 100) / 100).toFixed(3));
    pushSamplerEmuParams();

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        spb('section_mode', sec + ':' + s.sections[sec].mode, 200);
    }

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        for (let bank = 0; bank < BANK_COUNT; bank++) {
            applyBankStateToDsp(sec, bank, true);
        }
    }

    for (let sec = 0; sec < GRID_COUNT; sec++) {
        const bank = s.sections[sec].currentBank;
        spb('section_bank', sec + ':' + bank, 200);
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
    s.browserAssignMode = parsed.browserAssignMode === 'slot' || parsed.browserAssignMode === 'source' ? parsed.browserAssignMode : 'auto';

    s.globalGain = clampFloat(parsed.globalGain, 0.0, 4.0, 1.0);
    s.globalPitch = clampFloat(parsed.globalPitch, -48.0, 48.0, 0.0);
    s.velocitySens = clampInt(parsed.velocitySens, 0, 1, 0);
    s.recordMaxSeconds = clampInt(parsed.recordMaxSeconds, 1, 600, 30);
    s.recInputGainPct = clampInt(parsed.recInputGainPct, 0, 100, 100);
    s.recSchwungGainPct = clampInt(parsed.recSchwungGainPct, 0, 100, 100);
    s.samplerEmuMode = clampInt(parsed.samplerEmuMode, 0, 4, 0);
    s.samplerEmuBitDepth = clampInt(parsed.samplerEmuBitDepth, 4, 16, 16);
    s.samplerEmuRateHz = clampInt(parsed.samplerEmuRateHz, 2000, 96000, 44100);
    s.samplerEmuDrivePct = clampInt(parsed.samplerEmuDrivePct, 25, 400, 100);
    s.samplerEmuNoisePct = clampInt(parsed.samplerEmuNoisePct, 0, 100, 0);
    s.samplerEmuTonePct = clampInt(parsed.samplerEmuTonePct, 2, 100, 80);
    s.samplerEmuWetPct = clampInt(parsed.samplerEmuWetPct, 0, 100, 100);
    s.samplerEmuCompPct = clampInt(parsed.samplerEmuCompPct, 0, 100, 30);
    const rawLoopers = Array.isArray(parsed.midiLoopers) ? parsed.midiLoopers : [];
    s.midiLoopers = Array.from({ length: 4 }, (_, i) => sanitizeLooperState(rawLoopers[i]));
    s.activeLooper = clampInt(parsed.activeLooper, 0, 3, 0);
    s.loopPadMode = !!parsed.loopPadMode;

    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
    s.sections = [
        sanitizeSection(rawSections[0], MODE_SINGLE),
        sanitizeSection(rawSections[1], MODE_PER_SLOT)
    ];
    loadSamplerEmuFromBank(s.focusedSection);

    invalidatePlaybackCompat();
    applyAllStateToDsp();
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

    if (s.view !== 'main') return 'No action';

    if (s.shiftHeld && s.volumeTouchHeld) {
        if (idx === 0) return 'EMU mode';
        if (idx === 1) return 'EMU bit depth';
        if (idx === 2) return 'EMU sample rate';
        if (idx === 3) return 'EMU drive+comp';
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

    if (s.shiftHeld && !USE_STEP_BANKS && s.view === 'main') {
        setSectionBank(s.focusedSection, note);
        s.knobPage = note < 4 ? 'A' : 'B';
        showStatus('K' + (note + 1) + ' Bank ' + (note + 1), 60);
        return true;
    }

    s.knobPage = note < 4 ? 'A' : 'B';
    showStatus('K' + (note + 1) + ': ' + knobTouchActionLabel(note), 60);
    s.dirty = true;
    return true;
}

function handleStepBankNote(note, velocity) {
    if (!USE_STEP_BANKS || velocity <= 0) return false;
    const t = stepTargetFromNote(note);
    if (!t) return false;
    if (LEFT_GRID_ONLY && t.sec !== 0) return true;

    if (s.shiftHeld && s.volumeTouchHeld) {
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

function looperErase() {
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
        showStatus('Looper ' + (clampInt(index, 0, 3, 0) + 1) + ': unquantized', 100);
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
    showStatus('Looper ' + (clampInt(index, 0, 3, 0) + 1) + ': quantized 1/' + safeSteps, 100);
    markSessionChanged();
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
    releaseVoicesByOwner('looper:' + String(clampInt(s.activeLooper, 0, 3, 0)), looperNowMs());
    if (l.state === 'recording') looperFinishRecordingStartPlayback();
    if (l.state === 'playing' || l.state === 'overdub') {
        l.state = 'stopped';
        l.buttonHeld = false;
        l.buttonDownTick = -1;
    }
}

function selectLooper(index) {
    const next = clampInt(index, 0, 3, 0);
    if (next === s.activeLooper) return;
    stopActiveLooperForSwitch();
    s.activeLooper = next;
    updateUtilityButtonLeds();
    markLedsDirty();
}

function fireLooperPad(index) {
    const next = clampInt(index, 0, 3, 0);
    if (next !== s.activeLooper) selectLooper(next);
    if (s.shiftHeld) {
        looperQuantize(next, 16);
        return;
    }
    handleLoopButtonPress(false);
}

function toggleLoopPadMode() {
    s.loopPadMode = !s.loopPadMode;
    showStatus(s.loopPadMode ? 'Looper pad mode ON' : 'Looper pad mode OFF', 90);
    markLedsDirty();
    updateUtilityButtonLeds();
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

function flashPadPress(sec, bank, slot) {
    const key = sec + ':' + bank + ':' + slot;
    s.padPressFlash[key] = s.transportTicks + PAD_PRESS_FLASH_TICKS;
    markLedsDirty();
}

function triggerPadOn(sec, bank, slot, velocity, routeBank, recordToLooper = true, sourceTag = '') {
    if (isPadMuted(sec, bank, slot)) return false;
    flashPadPress(sec, bank, slot);
    s.lastPadTriggerTick = s.transportTicks;
    const triggerNote = padNoteFor(sec, slot);
    const vel = clampInt(velocity, 1, 127, 100);
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
    if (routeBank) {
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
        routeBank: !!routeBank,
        owner: src,
        sourceTag: src,
        startedMs: nowMs,
        lastOnMs: nowMs
    };
    return true;
}

function triggerPadOff(sec, bank, slot, routeBank, recordToLooper = true) {
    const addr = { sec, bank, slot };
    if (!currentVoiceAt(sec, bank, slot) && !shouldSendNoteOffForAddr(addr)) return false;
    return releaseActiveVoice(sec, bank, slot, routeBank, recordToLooper, Date.now());
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
            triggerPadOn(ev.sec, ev.bank, ev.slot, vel, true, false, 'looper:' + String(clampInt(s.activeLooper, 0, 3, 0)));
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

function addrKey(sec, bank, slot) {
    return String(clampInt(sec, 0, GRID_COUNT - 1, 0)) + ':' +
        String(clampInt(slot, 0, GRID_SIZE - 1, 0));
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

    const elapsed = Math.max(0, nowMs - clampInt(voice.startedMs, 0, 0x7fffffff, nowMs));
    if (!forceImmediate && elapsed < MIDI_MIN_NOTE_LENGTH_MS) {
        pendingNoteOffsByAddr[key] = {
            sec,
            bank,
            slot,
            routeBank: !!routeBank,
            recordToLooper: !!recordToLooper,
            dueAtMs: nowMs + (MIDI_MIN_NOTE_LENGTH_MS - elapsed)
        };
        return true;
    }

    clearPendingOff(sec, bank, slot);
    emitPadNoteOffNow(sec, bank, slot, routeBank, recordToLooper);
    delete activeVoicesByAddr[key];
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
    }
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
    }
}

function handlePadNote(note, velocity) {
    if (velocity <= 0) return false;
    if (note < PAD_NOTE_MIN || note > PAD_NOTE_MAX) return false;
    if (s.loopPadMode) {
        const lp = loopPadIndexFromPadNote(note);
        if (lp >= 0) {
            fireLooperPad(lp);
            return true;
        }
    }

    const slice = s.shiftHeld ? sliceFromPadNote(note) : playableSliceFromPadNote(note);
    if (slice < 0) return false;
    const sec = sectionFromSlice(slice);
    const bank = focusedBankIndex(sec);
    const slot = slotFromSlice(slice);
    const addr = { sec, bank, slot };
    const triggerNote = padNoteFor(sec, slot);

    if (s.muteHeld && !s.shiftHeld) {
        togglePadMute(sec, bank, slot);
        return true;
    }

    if (!s.shiftHeld) {
        if (!triggerPadOn(sec, bank, slot, velocity, false, true, 'pad:' + String(note))) return true;
        s.activePadPress[String(note)] = { sec, bank, slot, triggerNote, velocity: clampInt(velocity, 1, 127, 100) };
        s.editScope = 'P';
        /* Use blocking cursor sync so immediate knob turns always target the newly selected chop/slot. */
        setSelectedSlice(slice, true, false);
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

    triggerPadOff(addr.sec, addr.bank, addr.slot, false);
    return true;
}

function withPlaybackBank(sec, bank, fn) {
    const sSec = clampInt(sec, 0, GRID_COUNT - 1, 0);
    const targetBank = clampInt(bank, 0, BANK_COUNT - 1, 0);
    const visibleBank = clampInt(s.sections[sSec].currentBank, 0, BANK_COUNT - 1, 0);

    spb('section_bank', sSec + ':' + targetBank, 120);
    try {
        fn();
    } finally {
        if (targetBank !== visibleBank) spb('section_bank', sSec + ':' + visibleBank, 120);
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

function computeAbsoluteKnobDelta(prevValue, nextValue) {
    const prev = clampInt(prevValue, -1, 127, -1);
    const next = clampInt(nextValue, 0, 127, 0);
    if (prev < 0 || next === prev) return 0;
    return next > prev ? 1 : -1;
}

function decodeMasterKnobDelta(value) {
    const v = clampInt(value, 0, 127, 0);
    const prev = s.masterKnobLast;
    s.masterKnobLast = v;
    return computeAbsoluteKnobDelta(prev, v);
}

function runInternalSelfChecks() {
    const checks = [
        { prev: -1, next: 80, want: 0 },
        { prev: 80, next: 90, want: 1 },
        { prev: 90, next: 10, want: -1 },
        { prev: 40, next: 40, want: 0 }
    ];
    for (let i = 0; i < checks.length; i++) {
        const c = checks[i];
        const got = computeAbsoluteKnobDelta(c.prev, c.next);
        if (got !== c.want) {
            showStatus('Self-check fail M' + i, 60);
            try { console.log('TwinSampler self-check failed at ' + i + ' got=' + got + ' want=' + c.want); } catch (e) {}
            return false;
        }
    }
    return true;
}

function handleParamKnob(cc, delta) {
    if (delta === 0) return;

    if (s.view === 'browser' && s.browserMode === 'sessions') {
        if (cc === MoveKnob1) adjustSessionNameIndex(delta);
        else if (cc === MoveKnob2) adjustSessionNameChar(delta);
        return;
    }

    if (s.view !== 'main') return;

    const inA = cc === MoveKnob1 || cc === MoveKnob2 || cc === MoveKnob3 || cc === MoveKnob4;
    const inB = cc === MoveKnob5 || cc === MoveKnob6 || cc === MoveKnob7 || cc === MoveKnob8;
    if (!inA && !inB) return;

    if (s.shiftHeld && s.volumeTouchHeld) {
        if (cc === MoveKnob1) {
            adjustSamplerEmuMode(delta);
            return;
        }
        if (cc === MoveKnob2) {
            adjustSamplerEmuBitDepth(delta);
            return;
        }
        if (cc === MoveKnob3) {
            adjustSamplerEmuRate(delta);
            return;
        }
        if (cc === MoveKnob4) {
            adjustSamplerEmuDrive(delta);
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
        else if (cc === MoveKnob5) togglePadMode();
        else if (cc === MoveKnob6) adjustPadPitch(delta);
        else if (cc === MoveKnob7) adjustPadGain(delta);
        else if (cc === MoveKnob8) adjustPadLoop(delta);
    } else {
        if (cc === MoveKnob1) adjustAllAttack(delta);
        else if (cc === MoveKnob2) adjustAllDecay(delta);
        else if (cc === MoveKnob3) adjustAllStartTrim(delta);
        else if (cc === MoveKnob4) adjustAllEndTrim(delta);
        else if (cc === MoveKnob5) toggleAllMode();
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
    syncCaptureMeters();
    syncFocusedSlotPlaybackCompat();
}

function syncCaptureMeters() {
    const inputPeak = clampFloat(gp('capture_input_peak', s.captureInputPeak), 0.0, 2.0, s.captureInputPeak);
    const busPeak = clampFloat(gp('capture_bus_peak', s.captureBusPeak), 0.0, 2.0, s.captureBusPeak);
    const changed = Math.abs(inputPeak - s.captureInputPeak) > 0.0005 || Math.abs(busPeak - s.captureBusPeak) > 0.0005;
    s.captureInputPeak = inputPeak;
    s.captureBusPeak = busPeak;

    const clipped = inputPeak >= INPUT_CLIP_WARN_THRESHOLD || busPeak >= INPUT_CLIP_WARN_THRESHOLD;
    if (clipped) {
        s.clipWarnTicks = 30;
        s.dirty = true;
        return;
    }

    if (s.clipWarnTicks > 0) {
        s.clipWarnTicks--;
        if (s.clipWarnTicks === 0) s.dirty = true;
    }

    if (changed && isRecordModeActive()) s.dirty = true;
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
    s.recordArmed = s.recording ? true : false;
    s.recordState = s.recording ? 'recording' : (s.recordArmed ? 'armed' : 'idle');
    s.recordStateTicks = 0;
    s.recordLoadOnStop = false;
    s.recordMonitorOn = s.recording ? true : false;
    s.recordBlinkOn = s.recording ? true : false;
    s.recordBlinkTicks = 0;
    updateRecordButtonLed();

    s.recInputGainPct = clampInt(Math.round(clampFloat(gp('input_capture_gain', 1.0), 0.0, 1.0, 1.0) * 100), 0, 100, 100);
    s.recSchwungGainPct = clampInt(Math.round(clampFloat(gp('record_mix_gain', 1.0), 0.0, 1.0, 1.0) * 100), 0, 100, 100);
    s.captureInputPeak = clampFloat(gp('capture_input_peak', 0.0), 0.0, 2.0, 0.0);
    s.captureBusPeak = clampFloat(gp('capture_bus_peak', 0.0), 0.0, 2.0, 0.0);
    s.clipWarnTicks = 0;
    s.samplerEmuMode = clampInt(gp('sampler_emu_mode', 0), 0, 4, 0);
    s.samplerEmuBitDepth = clampInt(gp('sampler_emu_bit_depth', 16), 4, 16, 16);
    s.samplerEmuRateHz = clampInt(gp('sampler_emu_resample_hz', 44100), 2000, 96000, 44100);
    s.samplerEmuDrivePct = clampInt(Math.round(clampFloat(gp('sampler_emu_drive', 1.0), 0.25, 4.0, 1.0) * 100), 25, 400, 100);
    s.samplerEmuNoisePct = clampInt(Math.round(clampFloat(gp('sampler_emu_noise', 0.0), 0.0, 1.0, 0.0) * 100), 0, 100, 0);
    s.samplerEmuTonePct = clampInt(Math.round(clampFloat(gp('sampler_emu_tone', 0.8), 0.02, 1.0, 0.8) * 100), 2, 100, 80);
    s.samplerEmuWetPct = clampInt(Math.round(clampFloat(gp('sampler_emu_wet', 1.0), 0.0, 1.0, 1.0) * 100), 0, 100, 100);
    s.samplerEmuCompPct = clampInt(Math.round(clampFloat(gp('sampler_emu_comp', 0.30), 0.0, 1.0, 0.30) * 100), 0, 100, 30);

    sp('keyboard_section', String(s.focusedSection));
    sp('record_max_seconds', String(s.recordMaxSeconds));
    sp('input_capture_gain', (s.recInputGainPct / 100).toFixed(3));
    sp('record_mix_gain', (s.recSchwungGainPct / 100).toFixed(3));
    pushSamplerEmuParams();

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
                if (handlePadNoteRelease(b1)) return;
                return;
            }
            if (handleKnobTouch(b1, b2)) return;
            if (handleStepBankNote(b1, b2)) return;
            if (handlePadNote(b1, b2)) return;
            return;
        }

        if (status === 0x80) {
            if (handlePadNoteRelease(b1)) return;
            return;
        }

        if (status !== 0xB0) return;

        const cc = b1;
        const val = b2;

        if (cc === MoveShift) {
            const wasHeld = s.shiftHeld;
            s.shiftHeld = val > 0;
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
            if (s.muteHeld) showStatus('Mute hold: tap pad', 70);
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
            const delta = decodeMasterKnobDelta(val);
            if (delta === 0) return;
            if (!isRecordModeActive()) {
                showStatus('Master disabled (use K7)', 40);
                return;
            }
            adjustRecordCaptureGain(delta, s.shiftHeld ? 'schwung' : 'line');
            return;
        }

        if (cc === MoveDelete && val > 0) {
            if (s.view === 'browser' && s.browserMode === 'sessions') {
                deleteSelectedSession();
                return;
            }
            if (s.view === 'browser' && s.browserMode === 'samples') {
                deleteSelectedSampleFile();
                return;
            }
            if (s.view === 'main') {
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

        if (cc === MoveCopy && val > 0) {
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
            } else {
                toggleVelocitySens();
            }
            return;
        }

        if (cc === MoveCapture && val > 0) {
            if (s.view === 'main') randomizeFocusedTransientSlices();
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
    s.masterKnobLast = -1;
    s.padPressFlash = {};
    runInternalSelfChecks();
    s.sections = [
        makeSection(MODE_SINGLE),
        makeSection(MODE_PER_SLOT)
    ];

    initFromDspDefaults();
    activateStandaloneMidiPort();
    browserOpen(SAMPLES_DIR, 'samples');
    s.copySource = null;
    s.sessionBrowserIntent = 'load';
    s.sessionName = sanitizeSessionName(s.sessionName);
    s.sessionCharIndex = clampInt(s.sessionCharIndex, 0, Math.max(0, s.sessionName.length - 1), 0);
    ensureInitSessionFile(false);

    if (!loadSessionFromPath(autosavePath(), true, false) &&
        !loadSessionFromPath(sessionPathFromName(s.sessionName), true, false) &&
        !loadLegacySession(true) &&
        !loadSessionFromPath(sessionPathFromName(INIT_SESSION_NAME), true, false)) {
        applyAllStateToDsp();
    }

    s.view = 'main';
    s.muteHeld = false;
    s.loopPadMode = false;
    s.transportTicks = 0;
    s.activeLooper = 0;
    for (const k in activeVoicesByAddr) delete activeVoicesByAddr[k];
    for (const k in pendingNoteOffsByAddr) delete pendingNoteOffsByAddr[k];
    s.midiLoopers = [createLooperState(), createLooperState(), createLooperState(), createLooperState()];
    looperReset(true);
    s.autosavePending = false;
    s.autosaveTicks = 0;
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
    tickMidiLooperButtonHold();
    tickMidiLooperPlayback();
    tickPadPressFlash();
    tickMidiEchoCache();
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
