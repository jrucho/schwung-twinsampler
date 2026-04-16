import * as moveConstants from '/data/UserData/schwung/shared/constants.mjs';
import './ui_chain.js';

const MoveBack = Number.isFinite(moveConstants.MoveBack) ? moveConstants.MoveBack : 51;
const MoveShift = Number.isFinite(moveConstants.MoveShift) ? moveConstants.MoveShift : 49;
const MoveMasterTouch = Number.isFinite(moveConstants.MoveMasterTouch) ? moveConstants.MoveMasterTouch : 8;
const impl = (globalThis && globalThis.twinsampler_chain_ui && globalThis.twinsampler_chain_ui.__moduleId === 'twinsampler_overtake')
    ? globalThis.twinsampler_chain_ui
    : {};
let exitRequested = false;
let shiftHeld = false;
let volumeTouchHeld = false;
let backgrounded = false;

function safeInvoke(label, fn, arg) {
    if (typeof fn !== 'function') return;
    try {
        fn(arg);
    } catch (e) {
        try {
            const msg = e && e.stack ? e.stack : String(e);
            console.log('TwinSampler ' + label + ' error: ' + msg);
        } catch (e2) {}
    }
}

globalThis.init = function() {
    exitRequested = false;
    shiftHeld = false;
    volumeTouchHeld = false;
    backgrounded = false;
    if (typeof impl.init !== 'function') {
        try {
            console.log('TwinSampler init error: twinsampler_chain_ui missing or invalid');
        } catch (e) {}
    }
    safeInvoke('init', impl.init);
};

globalThis.tick = function() {
    if (backgrounded) return;
    safeInvoke('tick', impl.tick);
};

globalThis.onMidiMessageInternal = function(data) {
    if (backgrounded) return;
    const status = data[0] & 0xF0;
    const b1 = data[1] & 0x7F;
    const b2 = data[2] & 0x7F;

    if (status === 0xB0 && b1 === MoveShift) {
        shiftHeld = b2 > 0;
    } else if ((status === 0x90 || status === 0x80) && b1 === MoveMasterTouch) {
        volumeTouchHeld = (status === 0x90 && b2 > 0);
    }

    if (status === 0xB0 && b1 === MoveBack && b2 > 0) {
        if (shiftHeld && volumeTouchHeld) {
            safeInvoke('beforeExit', impl.beforeExit);
            requestExitModule();
        } else {
            requestBackgroundMode();
        }
        return;
    }

    safeInvoke('onMidiMessageInternal', impl.onMidiMessageInternal, data);
};

function requestBackgroundMode() {
    backgrounded = true;
    safeInvoke('beforeExit', impl.beforeExit);
    try {
        if (typeof shadow_set_overtake_mode === 'function') {
            shadow_set_overtake_mode(0);
        }
    } catch (e) {}
    try {
        if (typeof shadow_request_background === 'function') {
            shadow_request_background();
        }
    } catch (e) {}
    try {
        if (typeof shadow_request_exit === 'function') {
            shadow_request_exit();
        }
    } catch (e) {}
}

globalThis.onMidiMessageExternal = function(data) {
    if (backgrounded) return;
    safeInvoke('onMidiMessageExternal', impl.onMidiMessageExternal, data);
};

function requestExitModule() {
    if (exitRequested) return;
    exitRequested = true;

    let exited = false;
    try {
        if (typeof host_exit_module === 'function') {
            host_exit_module();
            exited = true;
        }
    } catch (e) {
        try {
            const msg = e && e.stack ? e.stack : String(e);
            console.log('TwinSampler exit error: ' + msg);
        } catch (e2) {}
    }

    if (exited) return;

    try {
        if (typeof shadow_set_overtake_mode === 'function') {
            shadow_set_overtake_mode(0);
        }
    } catch (e) {}
    try {
        if (typeof shadow_request_exit === 'function') {
            shadow_request_exit();
        }
    } catch (e) {}
}
