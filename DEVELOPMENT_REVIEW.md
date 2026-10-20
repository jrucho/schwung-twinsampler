# TwinSampler startup and compatibility review

Reviewed 2026-10-20. TwinSampler baseline: `85e1381` (v0.3.7).
Schwung latest stable: [v1.7.3](https://github.com/charlesvestal/schwung/releases/tag/v1.7.3),
published 2026-10-04. Also checked upstream main `586aebd` (2026-10-15).

## 0.3.9 follow-up

The current local build is 0.3.9; 0.3.8 is retained as a backup. A private-buffer
ARM64 diagnostic on Move (Schwung 1.7.3) reproduced the source-loop level bug:
at 0.25 master gain, loop RMS was 4x one-shot RMS. The wrapper loop renderer
omitted global gain. After correction, loop and ping-pong RMS match one-shots
within about 0.2% for the tested velocities/gains; per-pad-mode loops also match.
The diagnostic does not write to Move's actual audio output.

The post-startup freeze had an explicit code path: a delayed whole-session
parameter replay and 24 forced focused-pad refreshes after `READY`. Startup
now completes its queued replay and focused sync before unlocking the UI and
does not schedule those extra passes. Later trim checks are incremental.

0.3.9 adds essential Trim/Chop waveform pages, 45 effect-specific named presets,
project restore progress and busy screens for sample/save/undo/redo/init.
Waveform work is optional display work, bounded and only performed in editors.
The rendering tests exercise all 45 preset rows, stereo Lo-fi, bit-exact bypass,
and loop global gain. See README for controls and `bash scripts/test.sh`.

The populated mock fixture now uses 3,455 write round-trips. The old 0.3.8
fixture used 10,456; valid saved cue tables add a small amount of work in the
new fixture. The reduction comes from batching selection/slice aliases and
removing duplicate FX aliases, not from deferring sample or effect state.
Opening-time measurements on the user's real sessions are still pending.

The earlier review below describes the original 0.3.8 work. The delayed
post-READY verification it mentions has been superseded by this follow-up.

## Changes implemented

- **Data-partition conversion cache.** Converted and reversed WAV files now
  use `/data/UserData/schwung/cache/twinsampler_sample_cache` instead of `/tmp`
  on the small system partition. Cache-directory creation validates that both
  paths are directories. The existing device's cache was relocated with a
  compatibility symlink at `/var/volatile/tmp/twinsampler_sample_cache`, so the
  temporary 0.4 installation can use the relocated cache immediately.
- **Ordered numeric batching during startup.** Schwung's `host_module_set_params`
  sends multiple edits in one round-trip. Batches contain at most 16 pairs,
  below the host's 32-pair limit. Duplicate compatibility writes and their order
  are retained. Reads and potentially expensive operations flush preceding edits.
  Sample paths, reversing, looping and slicing are never bulked together.
- **Backward compatibility.** Missing bulk APIs retain individual writes. A bulk
  failure disables batching for that instance and replays the numeric edits with
  blocking individual writes. Non-ASCII values use individual writes as well.
- **Responsive boot scheduling.** Up to eight jobs per tick on bulk-capable
  hosts, stopping between jobs after an 8 ms work budget. Legacy hosts keep the
  two-job limit. A single sample load may exceed this budget. The final pad
  replay is split into four-pad jobs rather than one whole-session UI freeze.
- **DSP readiness.** Startup waits if `__ready` is `"0"`. Older hosts without
  this parameter retain their previous startup behavior.
- **Session correctness.** Removed the unconditional velocity-off reset after
  restore. Exiting or suspending during boot no longer saves a partial session
  over autosave.
- **Background operation.** Use `host_suspend_overtake` before legacy fallbacks.
  Upstream `host_hide_module` only hides tool overtakes and otherwise does nothing.
- **Release checks.** CI runs startup regressions and installs the ARM compiler
  before packaging, avoiding the previous normal Ubuntu runner's fallback to a
  potentially outdated prebuilt wrapper.

## Verification and measurement

`bash scripts/test.sh` exercises INIT and a populated session with
16 source paths and 256 pad samples, including reverse, loop, pitch and trim
settings. The bulk and legacy paths must produce the **same ordered DSP write
trace and serialized session**. Additional checks cover failure fallback, batch
limits, Unicode paths, DSP loading, autosave protection and official suspend.

The 0.3.9 mock-host tests report **3,455** write round-trips for a populated
session, down from **10,456** for 0.3.8's fixture (itself down from 18,476).
These are communication counts, not hardware timings. The test models a fixed
cost per host round-trip; tick counts printed by the tests are illustrative
rather than an opening-time claim. The fixtures differ slightly because the
0.3.9 session includes valid saved cue tables.

On-device startup logs now include elapsed milliseconds, completed jobs, single
writes, successful batches and fallback count. Compare repeated opens of the
same session on the same device, including the first open after a reboot and
the first open after adding new samples. `READY` still follows all startup
sample loads and compatibility passes. The final replay now completes inside
the loading screen; any later trim verification advances incrementally.

## Schwung compatibility findings

- Module API v2 and `component_type: "overtake"` are still supported; no manifest
  API-version increase is indicated. The local host struct is the older prefix
  of the upstream append-only struct. New tail callbacks aren't used here.
- Bulk SET, DSP readiness and suspend are present in v1.7.3. Relevant host/shim
  files were unchanged between that release and the inspected main snapshot.
- Shared imports already use `/data/UserData/schwung/shared/`, as current Schwung
  expects. This development version adds a required local `param_transport.mjs`;
  install the whole packaged folder, not just the two UI files.
- v1.7.3 includes host-side wake-on-parameter-write fixes that benefit modules
  starting sound from a parameter. Those fixes belong to Schwung itself.
- Compatibility is source-reviewed and mock-tested, not yet verified with live
  audio, recording or suspended loopers on an Ableton Move.

Upstream references:
[overtake bindings](https://github.com/charlesvestal/schwung/blob/v1.7.3/src/shadow/shadow_ui.js),
[bulk implementation](https://github.com/charlesvestal/schwung/blob/v1.7.3/src/schwung_shim.c),
[plugin API](https://github.com/charlesvestal/schwung/blob/v1.7.3/src/host/plugin_api_v1.h).

## Highest-priority remaining improvements

1. **Move file work off the real-time audio thread.** The upstream API explicitly
   says live `set_param` runs on the SPI/audio callback. The wrapper currently
   inspects, converts, allocates and loads WAV data there. This can interrupt
   audio across the device. A proper worker/loading-completion protocol should
   keep the boot screen active until every required asset is ready. This is a
   larger architectural change, not solved by numeric batching.
2. **Recover the core DSP source.** `dsp_core.so` is supplied only as an ARM64
   binary/embedded blob in this repository. It prevents a complete source audit,
   core optimization and verification of its threading/loading behavior. The
   available C source is a wrapper around that binary.
3. **Profile first-use WAV conversion.** Resampling/reverse conversion can seek
   and read individual frames repeatedly. Buffered conversion should reduce
   first-use work. There is already a conversion cache, so adding another cache
   without measuring would duplicate existing functionality. Verify converted
   audio and cache invalidation before changing this path.
4. **Reduce compatibility replays only after device testing.** The code sends
   addressed and direct pad settings, effect aliases and repeated cue/trim
   passes. They are costly but may compensate for behavior in the binary core.
   This change retains them; removing them needs hardware-backed evidence.
5. **Report and recover failed sample loads.** Current UI setters swallow errors
   and do not consistently verify completion. A missing file or timeout may
   leave the UI showing a sample that did not load. Add acknowledged loading
   with per-file diagnostics/retry alongside the worker protocol.

## Device acceptance checks

Before publishing, compare a backup session on v1.7.3: play pads in all 16
banks; verify saved cuts, reverse, ping-pong, pitch and trims; check bank/global
effects; record from each supported input; exit/reopen; suspend/resume while
loopers play; and cancel startup to confirm the original autosave survives.
Measure actual opening times using the new startup log. No precise seconds
saved can be claimed from a mock host.
