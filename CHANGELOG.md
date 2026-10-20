# Changelog

## 0.3.9 — Local development, not yet published

### Fixed
- Source-mode loop and ping-pong playback now respect master gain, matching
  one-shot volume. A private-buffer diagnostic on Move reproduced a 4x level
  jump at 25% master gain in 0.3.8; 0.3.9's loop/one-shot RMS ratio is ~1.00.
- Removed the second full-session replay and repeated focused-pad refreshes
  after startup's `READY`, which could briefly freeze pad response. All initial
  compatibility replays remain inside the loading screen.
- Subsequent delayed trim verification advances in small, time-budgeted groups
  instead of replaying all 256 pads in a single UI tick.
- Lo-fi's sample-and-hold now updates both stereo channels.
- FX bypass remains bit-exact while maintaining recent audio history, so an
  immediate DJFX capture no longer starts with an empty history buffer.

### Added
- Sample waveform/trim page and a source-bank chop editor, with zoom, scroll,
  pad selection, audition and bounds-checked start/end editing. Waveform work
  begins only when an editor is opened, in bounded cancellable UI ticks.
- Loading screens before project restore, sample loading, explicit saving,
  new/init, undo and redo. Project restoration is split into progress jobs;
  individual file conversions and undo/redo DSP calls can still block while
  their loading screen remains visible.
- Five named, effect-specific presets for each of the nine FX (45 total).
  Preset output settings are more conservative. Existing saved parameter
  arrays are preserved; an asterisk marks edited/legacy parameter sets.

### Improved
- Batch compatible selection and slice-alias edits and remove duplicate FX
  alias writes. A populated startup fixture uses 3,455 write round-trips,
  compared with 10,456 in the previous 0.3.8 fixture (the new fixture also
  includes valid saved cue tables). Actual opening-time savings need device
  timing; no samples, banks or disabled-FX settings are deferred.
- Expanded checks cover waveform formats, editor addressing, loading lifecycle,
  absence of a post-READY replay, and native DSP rendering of all presets.

0.3.8 is preserved as `dist/twinsampler-0.3.8-backup.tar.gz` locally and as a
module/session archive under `/data/UserData/TwinSamplerBackups/` on Move.
No release, tag, commit or push has been created. The local `release.json`
points to the planned v0.3.9 asset, which exists only after publication.

## 0.3.8 — Local device build, not published

Based on the GitHub v0.3.7 code, not the temporary v0.4 device installation.

### Improved
- Faster startup communication on compatible Schwung hosts through ordered,
  bounded numeric parameter batches, with automatic legacy-host fallback.
  Mock-host verification shows approximately 43% fewer write round-trips;
  hardware opening-time measurements are still required.
- Time-budgeted startup scheduling and smaller final pad-replay jobs keep
  loading feedback responsive while retaining the full initial restore.
- Startup timing and parameter-transport statistics are written to the host log.

### Fixed
- Store converted/reversed sample caches on the large data partition instead
  of `/tmp` on Move's small system partition, preventing the cache from
  filling system storage and blocking updates.
- Preserve the session's saved velocity sensitivity when opening the module.
- Wait for the DSP when Schwung reports that it is still loading.
- Prevent exiting or suspending during startup from overwriting autosave with
  empty or partially restored state.
- Use Schwung's official overtake suspend API for background operation when
  available, instead of a tool-only hide callback.

### Development
- Added regression checks for full-session restore equivalence, transport
  fallback, Unicode sample paths, DSP readiness, autosave and suspend.
- Release CI now runs the checks and installs an ARM64 compiler before packaging.
- Added `DEVELOPMENT_REVIEW.md` with upstream compatibility findings and the
  remaining DSP/file-loading performance work.

## 0.3.7

Existing GitHub release used as the starting point for this development work.
