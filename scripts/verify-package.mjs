import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// Move's runtime is glibc 2.35. ARM64 alone does not guarantee loadability:
// Ubuntu 24.04's cross libraries introduce GLIBC_2.38 requirements.
const maxGlibc = [2, 35];
const dir = process.argv[2] || 'dist/twinsampler';
const candidates = process.env.READELF ? [process.env.READELF]
    : ['aarch64-linux-gnu-readelf', 'readelf'];
const readelf = candidates.find(command => spawnSync(command, ['--version']).status === 0);
assert.ok(readelf, 'Install ARM64 binutils (readelf) to verify the package');

for (const name of ['module.json', 'ui.js', 'ui_chain.js', 'help.json',
    'param_transport.mjs', 'waveform.mjs', 'fx_presets.mjs', 'dsp.so', 'dsp_core.so']) {
    assert.ok(fs.statSync(path.join(dir, name)).size > 0, name);
}

for (const name of ['dsp.so', 'dsp_core.so']) {
    const file = path.join(dir, name);
    const elf = fs.readFileSync(file);
    assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46', `${name}: ELF`);
    assert.equal(elf[4], 2, `${name}: ELF64`);
    assert.equal(elf[5], 1, `${name}: little endian`);
    assert.equal(elf.readUInt16LE(18), 183, `${name}: AArch64`);
    const versions = execFileSync(readelf, ['--version-info', '--wide', file], { encoding: 'utf8' });
    const required = [...new Set([...versions.matchAll(/Name: GLIBC_([\d.]+)/g)].map(match => match[1]))];
    assert.ok(required.length, `${name}: missing glibc dependency information`);
    for (const version of required) {
        const [major, minor, patch = 0] = version.split('.').map(Number);
        assert.ok(major < maxGlibc[0] || (major === maxGlibc[0] &&
            (minor < maxGlibc[1] || (minor === maxGlibc[1] && patch === 0))),
        `${name} requires GLIBC_${version}; Move supports at most GLIBC_2.35. Use the Ubuntu 22.04 cross toolchain.`);
    }
    const symbols = execFileSync(readelf, ['--dyn-syms', '--wide', file], { encoding: 'utf8' });
    assert.match(symbols, /GLOBAL\s+DEFAULT\s+\d+\s+move_plugin_init_v2\b/, `${name}: missing DSP entry point`);
    console.log(`${name}: ARM64, DSP entry point, compatible glibc requirements (${required.join(', ')})`);
}
