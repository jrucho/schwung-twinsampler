import * as moveConstants from '/data/UserData/schwung/shared/constants.mjs';
import './ui_chain.js';

const MoveBack = Number.isFinite(moveConstants.MoveBack) ? moveConstants.MoveBack : 51;
const MoveShift = Number.isFinite(moveConstants.MoveShift) ? moveConstants.MoveShift : 49;
const impl = (globalThis && globalThis.twinsampler_chain_ui && globalThis.twinsampler_chain_ui.__moduleId === 'twinsampler_overtake')
    ? globalThis.twinsampler_chain_ui
    : {};
let exitRequested = false;
let beforeExitDone = false;
let wrapperShiftHeld = false;

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
    beforeExitDone = false;
    wrapperShiftHeld = false;
    if (typeof impl.init !== 'function') {
        try {
            console.log('TwinSampler init error: twinsampler_chain_ui missing or invalid');
        } catch (e) {}
    }
    safeInvoke('init', impl.init);
};

function runBeforeExit() {
    if (beforeExitDone) return;
    beforeExitDone = true;
    safeInvoke('beforeExit', impl.beforeExit);
}

function tryHandleBackButton() {
    if (typeof impl.onBackButton !== 'function') return false;
    try {
        return impl.onBackButton() === true;
    } catch (e) {
        try {
            const msg = e && e.stack ? e.stack : String(e);
            console.log('TwinSampler back error: ' + msg);
        } catch (e2) {}
    }
    return false;
}

globalThis.tick = function() {
    safeInvoke('tick', impl.tick);
};

globalThis.onMidiMessageInternal = function(data) {
    const status = data[0] & 0xF0;
    if (status === 0xB0 && data[1] === MoveShift) wrapperShiftHeld = data[2] > 0;
    if (status === 0xB0 && data[1] === MoveBack && data[2] > 0) {
        if (wrapperShiftHeld && typeof impl.onShiftBackButton === 'function') {
            safeInvoke('shiftBack', impl.onShiftBackButton);
            return;
        }
        if (tryHandleBackButton()) return;
        runBeforeExit();
        requestExitModule();
        return;
    }

    safeInvoke('onMidiMessageInternal', impl.onMidiMessageInternal, data);
};

globalThis.onMidiMessageExternal = function(data) {
    safeInvoke('onMidiMessageExternal', impl.onMidiMessageExternal, data);
};

/* Best-effort lifecycle hooks for hosts that call explicit cleanup handlers. */
globalThis.beforeExit = function() {
    runBeforeExit();
};

globalThis.deinit = function() {
    runBeforeExit();
};

function requestExitModule() {
    if (exitRequested) return;
    exitRequested = true;
    runBeforeExit();

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

function leaveBackgroundModule() {
    let detached = false;
    const candidates = [
        'host_leave_module_background',
        'host_background_module',
        'host_minimize_module',
        'host_hide_module',
        'host_detach_ui',
        'host_return_to_previous',
        'host_show_launcher'
    ];
    for (let i = 0; i < candidates.length; i++) {
        const name = candidates[i];
        try {
            const fn = globalThis && globalThis[name];
            if (typeof fn === 'function') {
                console.log('TwinSampler background: ' + name);
                fn();
                detached = true;
                return;
            }
        } catch (e) {
            try {
                console.log('TwinSampler background error: ' + name + ' ' + String(e));
            } catch (e2) {}
        }
    }
    try {
        if (typeof shadow_set_overtake_mode === 'function') {
            console.log('TwinSampler background: shadow_set_overtake_mode');
            shadow_set_overtake_mode(0);
            detached = true;
        }
    } catch (e) {
        try {
            console.log('TwinSampler background error: ' + String(e));
        } catch (e2) {}
    }
    try {
        if (detached && typeof shadow_request_exit === 'function') {
            console.log('TwinSampler background: shadow_request_exit');
            shadow_request_exit();
        }
    } catch (e) {
        try {
            console.log('TwinSampler background exit error: ' + String(e));
        } catch (e2) {}
    }
}

globalThis.twinsampler_request_exit = requestExitModule;
globalThis.twinsampler_leave_background = leaveBackgroundModule;
