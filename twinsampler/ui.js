import './ui_chain.js';

const impl = (globalThis && globalThis.twinsampler_chain_ui && globalThis.twinsampler_chain_ui.__moduleId === 'twinsampler_overtake')
    ? globalThis.twinsampler_chain_ui
    : {};

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
    safeInvoke('onMidiMessageInternal', impl.onMidiMessageInternal, data);
};

globalThis.onMidiMessageExternal = function(data) {
    safeInvoke('onMidiMessageExternal', impl.onMidiMessageExternal, data);
};
