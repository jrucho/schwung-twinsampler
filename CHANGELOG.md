# Changelog

## 0.4.1

### Fixed
- Trim/CHOP start/end edits honor the trim-sound toggle, matching Main. Turning
  auditioning back on works while the same pad is still held, including PAD mode.
  Shift + master-volume touch + K3 touch toggles once per fresh touch; repeated
  touch messages and capacitive releases no longer flip it back or leave Master held.
- P1's manual CHOP start now affects actual playback, not just the waveform.
  The core's pinned first boundary is translated into a playback offset;
  cached data-partition source windows support starts beyond its five-second
  trim limit while project cues remain in original sample coordinates.
- Held source-pad envelope and gain edits audition a refreshed voice. Drum
  trigger voices use edited sound parameters on the next hit without an
  overlapping preview. Gate-mode K2 is labeled Release.
- Editor sound changes synchronize the DSP edit target and use acknowledged
  writes so attack/decay/mode changes are not lost in the nonblocking queue.
- Shift + K1/K2/K5/K7/K8 performs bank-wide attack, decay/release, mode, gain
  and loop edits in Trim/CHOP; Shift + K3/K4 keeps coarse edge editing.
- Record monitoring respects master gain and suppresses an input already
  audible through Move's bus. Automatic capture avoids recording that copy twice.
- Refresh the imported UI implementation on module reopen through Schwung's
  cache-busting loader so updated files do not leave the prior editor running.
- Shift + K6 adjusts the focused bank's pitch in Trim and CHOP, matching Main.
  Plain K6 continues to adjust only the selected pad.
- Record can arm, start, stop, and stop+load from Trim and CHOP.
- Pitch touch labels identify bank pitch consistently in both section modes.
- A zero pad pitch no longer conceals global transposition: nonzero global pitch
  appears alongside local and effective pitch in the Main/editor readouts and
  pitch-knob feedback. Recording state also remains visible in editor footers.
- Release builds use Ubuntu 22.04's Move-compatible cross libraries, reject DSP
  requirements above GLIBC 2.35, and render pad audio from the exact archive in
  ARM64 emulation before upload. Rebuilding with the former Ubuntu 24.04 cross
  libraries reproduced `GLIBC_2.38 not found` on Move.

### Notes
- The reported default -2.5 semitone offset was traced to saved global pitch,
  not recording or sample-rate conversion. Fresh pad/global defaults are zero;
  intentional project tuning remains preserved. Reset global pitch to 0.0 in
  affected sessions to remove the offset from future playback.

## 0.4.0

### Fixed
- Jog press opens the sample browser from Trim and CHOP using the same selected
  pad/bank and assignment behavior as main, rather than auditioning a pad.
- The screen follows the last played pad after triggering its note, independently
  of each bank's saved Trim/CHOP mode and resident playback map. Knobs edit the
  displayed pad, while CHOP cue marking and LEDs stay tied to their own bank.
- Alternating CHOP and drum grids uses local screen focus instead of reopening
  editors, restoring maps and forcing cursor/LED sync ahead of every note. Bank
  chop maps stay resident, WAV metadata is cached, and waveform work is deferred
  briefly after pad hits.
- Empty CHOP pads mark new cues directly during playback; marked pads play their
  slices, with Shift + pad available to re-mark existing cues.
- CHOP pads play their manual slices through the normal sampler. Shift no longer
  starts a full-file preview; play P1, then Shift + pad marks cues during playback.
  Pad presses from main restore the played bank's remembered editor.
- Source-mode loop and ping-pong playback now respect master gain, matching
  one-shot volume. A private-buffer diagnostic on Move reproduced a 4x level
  jump at 25% master gain in the development 0.3.8 build; the fixed loop/one-shot
  RMS ratio is ~1.00.
- Removed the second full-session replay and repeated focused-pad refreshes
  after startup's `READY`, which could briefly freeze pad response. All initial
  compatibility replays remain inside the loading screen.
- Subsequent delayed trim verification advances in small, time-budgeted groups
  instead of replaying all 256 pads in a single UI tick.
- Arrow navigation steps through Main, Trim and CHOP one level per press;
  repeated held-button messages no longer skip levels. Left/Right changes the
  looper pad view from either editor when looper pad mode is active.
- Capture now randomizes the focused source-bank chops from the trim and chop
  editors, matching its behavior on the main screen.
- Lo-fi's sample-and-hold now updates both stereo channels.
- FX bypass remains bit-exact while maintaining recent audio history, so an
  immediate DJFX capture no longer starts with an empty history buffer.

### Added
- Sample waveform/trim page and a source-bank chop editor, with zoom, scroll,
  pad selection, audition and bounds-checked start/end editing. Waveform work
  begins only when an editor is opened, in bounded cancellable UI ticks.
- CHOP has an independent manual map with no internal cues by default. P1
  spans the sample and is lit in the bank color; P2-P16 stay dark until
  an empty pad or Shift + pad marks a cue during playback. K3 moves the P1 start manually,
  and Erase + pad empties only that cue while later cues stay put. Each source
  bank keeps separate manual and transient/random maps, and both are saved with
  the project.
- Each source bank remembers its own Trim or CHOP editor mode. Switching banks,
  including between the left and right grids, restores that bank's mode, and the
  per-bank choices are saved with the project.
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

This release includes the work previously labeled 0.3.8 and 0.3.9 during local
development; neither development version was published as a GitHub release.

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
