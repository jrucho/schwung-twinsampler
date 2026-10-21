# TwinSampler 0.4.1

## Fixes

- **Trim audition toggle:** hold Shift, touch the master-volume knob, then touch
  K3. ON/OFF now controls Trim/CHOP auditions as well as Main. Touch repeats and
  capacitive releases are handled without double-toggling. Running loops stay live.
- **Release DSP compatibility:** build with a Move-compatible glibc baseline,
  reject newer runtime dependencies, and test actual packaged ARM64 pad audio
  before uploading. The previous release environment could produce
  `GLIBC_2.38 not found` on Move, leaving pads silent despite a working UI.
- **Editor sound controls:** Shift + K1/K2/K5/K6/K7/K8 edits bank attack,
  decay/release, Trigger/Gate, pitch, gain and loop. Plain knobs edit the selected
  pad. Held source-pad edits audition a refreshed voice; drum one-shots use the
  new sound on their next hit. K2 is labeled Release in Gate mode.
- **Movable first chop:** select P1 in CHOP and turn K3 to move its actual
  playback start, including beyond five seconds. Shift + K3 moves in 10 ms
  steps. Later cues keep their positions, and the first start is saved.
- **Recording monitor level:** monitoring follows master gain and avoids adding
  an input already present on Move's output bus a second time. Automatic capture
  also avoids summing the same input twice.
- **Recording in the editors:** Record arms, starts and stops recording without
  leaving Trim or CHOP. Shift + Record disarms, or stops and loads a recording.
  The destination remains locked to the pad/bank selected when recording starts.
- **Pitch feedback:** when global tuning is nonzero, local pitch, global pitch
  and their effective sum are displayed together. A pad reading zero can no
  longer silently conceal a global -2.5 semitone offset.
- **Update reload:** reopening TwinSampler refreshes the imported UI implementation
  through Schwung's loader, avoiding stale editor code after an installation.

## Pitch settings

The reported -2.5 semitone offset was a saved **global pitch** setting. Pad and
global pitch default to zero. Global tuning affects all samples, including new
imports and recordings; return it to **0.0** in affected projects. Bank and pad
pitch settings remain independent, and saved project tuning is preserved.
Loading a session restores all saved pitch values. Only replacing a bank's
source or an individual pad's sample resets the corresponding bank/pad settings.

## Installation

Build with `bash scripts/build.sh`. Extract `dist/twinsampler-module.tar.gz` and
copy its `twinsampler/` folder into `modules/overtake/` on Move, then fully exit
and reopen the module. A matching `.sha256` file is generated with the archive.

## Verification

- 42 automated checks for UI control routing, session restore, waveform editing,
  saved pitch, source audition and native DSP/monitoring behavior.
- 170 private-buffer ARM64 audio cases passed on Move, including JS-generated
  control replay, pitch at 44.1/48 kHz, and P1 at 6 seconds with Trim/CHOP restore.
- Release CI checks the extracted archive's ARM64 runtime requirements and replays
  these audio probes under emulation. The published asset is the exact archive
  installed and verified on Move, not a separate CI rebuild.
