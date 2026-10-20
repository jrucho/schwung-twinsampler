/* Schwung's bulk SET contains length-prefixed UTF-8 key/value records.
 * Only batch bounded numeric edits: file loads, slicing, reverse and loop
 * changes can do expensive work and must keep their own host round-trip. */
const BATCHABLE = /^(?:(?:performance_fx|pfx)_(?:global|bank)_(?:toggle|param)|edit_(?:section|bank|slot)|selected_(?:slice|slot)|(?:slot|slice)_(?:attack|decay|start_trim|end_trim|gain|pan|pitch|mode)(?:_at)?)$/;
const MAX_PAIRS = 16; // Host accepts at most 64 records (=32 pairs).

export function createParamTransport(host) {
    let depth = 0;
    let pending = [];
    let bulkFailed = false;
    const stats = { writes: 0, singles: 0, batches: 0, fallbacks: 0 };

    function canBatch() {
        return !bulkFailed && typeof host.setMany === 'function' && host.hasBulk();
    }

    function single(item, ordered = false) {
        stats.singles++;
        return host.set(item.key, item.value, item.timeout || (ordered ? 250 : 0));
    }

    function flush() {
        if (!pending.length) return;
        const items = pending;
        pending = [];
        // All batchable values are numeric ASCII. Keep lengths byte-correct by
        // refusing other characters in set(), rather than using UTF-16 lengths.
        const records = [];
        for (const item of items) records.push(item.key, item.value);
        const blob = records.length + '\n' + records.map(v => v.length + '\n' + v).join('');
        let ok = false;
        try { ok = host.setMany(blob) === true; } catch (e) {}
        if (ok) {
            stats.batches++;
            return;
        }
        // Numeric edits are idempotent, so replay is safe even if a timed-out
        // bulk request was partially applied. Use ordered individual writes.
        bulkFailed = true;
        stats.fallbacks++;
        for (const item of items) single(item, true);
    }

    function set(key, value, timeout = 0) {
        value = String(value);
        stats.writes++;
        const item = { key, value, timeout };
        if (depth && canBatch() && BATCHABLE.test(key) && /^[\x20-\x7e]*$/.test(value)) {
            pending.push(item);
            if (pending.length >= MAX_PAIRS) flush();
            return;
        }
        flush();
        return single(item);
    }

    function batch(fn) {
        depth++;
        try { return fn(); }
        finally {
            depth--;
            if (!depth) flush();
        }
    }

    return { set, flush, batch, canBatch, stats };
}
