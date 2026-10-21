# TwinSampler 0.4.0

Live chopping, waveform editors and smoother dual-grid performance for Ableton
Move running Schwung.

## Highlights

- **Trim and CHOP waveform editors:** Down steps Main → Trim → CHOP; Up returns
  CHOP → Trim → Main. K3/K4 edit edges, Shift+Jog zooms, and Jog press opens the
  sample library from either editor.
- **Live cue marking:** play the bank-colored P1, then tap empty pads to mark new
  chops. Marked pads play their slices; Shift+pad re-marks cues and Erase+pad
  empties a cue without shifting the later pads. Shift alone stays silent.
- **Independent bank modes:** each bank remembers Trim or CHOP in saved projects.
  Manual CHOP maps are separate from transient/random chop maps.
- **Play both grids together:** the screen follows the last played drum or chop
  after its note triggers. Both playback maps stay ready, cue LEDs remain tied to
  their own bank, and knobs edit the displayed pad.
- **Looper navigation inside editors:** Left/Right changes the looper pad view
  whenever looper pad mode is active; otherwise it scrolls the waveform.
- **Loading and startup improvements:** progress screens for project/sample
  loading, saving, init and undo/redo; bounded restore work and no delayed
  whole-session replay after READY.
- **FX improvements:** 45 named effect presets, corrected stereo Lo-fi, DJFX
  capture history after bypass, and matching master gain for source one-shots,
  loops and ping-pong playback.

## Installation and updating

Update **TwinSampler** through the **Schwung Module Store**. Its existing catalog
entry reads this repository's `release.json`, which points to the v0.4.0 package.

For manual installation, download **twinsampler-module.tar.gz** and extract its
`twinsampler/` folder into `modules/overtake/`. A SHA-256 checksum is supplied as
**twinsampler-module.tar.gz.sha256**. Reload TwinSampler after installing.

Existing projects remain loadable. New saves include per-bank editor modes and
manual cue maps. Cue positions follow pad order; the displayed marking playhead
is estimated from slice playback, pitch, reverse and loop settings.

## Verification

- 30 automated checks covering startup/restore, waveform formats, DSP rendering,
  live cue marking, editor navigation, sample browsing and cross-grid playback.
- Alternating-grid checks verify note delivery precedes display following, with
  no editor-setup/map-restore traffic between warmed-up hits.
- Installable ARM64 DSP rebuilt from the wrapper source during release CI.

The optional bulk host API is used when available, with an individual-write
fallback for older Schwung hosts. The catalog's minimum host requirement remains
0.3.6; the development/device checks used Schwung 1.7.3.
