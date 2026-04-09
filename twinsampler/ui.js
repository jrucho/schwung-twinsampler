import * as moveConstants from '/data/UserData/schwung/shared/constants.mjs';
import './ui_chain.js';

const MoveBack = Number.isFinite(moveConstants.MoveBack) ? moveConstants.MoveBack : 51;
const impl = (globalThis && globalThis.twinsampler_chain_ui && globalThis.twinsampler_chain_ui.__moduleId === 'twinsampler_overtake')
    ? globalThis.twinsampler_chain_ui
    : {};
let exitRequested = false;

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
    if (typeof impl.init !== 'function') {
        try {
            console.log('TwinSampler init error: twinsampler_chain_ui missing or invalid');
        } catch (e) {}
    }
    safeInvoke('init', impl.init);
};

globalThis.tick = function() {
    safeInvoke('tick', impl.tick);
};

globalThis.onMidiMessageInternal = function(data) {
    const status = data[0] & 0xF0;
    if (status === 0xB0 && data[1] === MoveBack && data[2] > 0) {
        safeInvoke('beforeExit', impl.beforeExit);
        requestExitModule();
        return;
    }

    safeInvoke('onMidiMessageInternal', impl.onMidiMessageInternal, data);
};

globalThis.onMidiMessageExternal = function(data) {
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
