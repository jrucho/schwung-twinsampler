# schwung-twinsampler

`TwinSampler` is an overtake sampler module for Schwung on Ableton Move.

It gives you two 4x4 pad sections (left/right), with 8 banks per section, quick sample loading, recording, and session save/load.

[![Watch the video](https://img.youtube.com/vi/dNPo0ITg-AQ/0.jpg)](https://youtu.be/dNPo0ITg-AQ)

▶️ Demo (YouTube): https://youtu.be/dNPo0ITg-AQ

> GitHub README files do not support an inline playable YouTube embed.  
> To get a **playable video directly on GitHub**, add an `.mp4/.webm` file to this repo and use an HTML `<video>` tag that points to that file.

---

## Install

Place this folder at:

`modules/overtake/twinsampler`

Required files:
- `dsp.so`
- `dsp_core.so`
- `dsp_wrapper_monitor.c`
- `help.json`
- `module.json`
- `plugin_api_v1.h`
- `ui.js`
- `ui_chain.js`

---

## Quick Start (Simple)

1. Press `Jog click` to open the sample browser.
2. Load a WAV file.
3. Play pads on the left/right 4x4 sections.
4. Use `Step 1-16` to change banks (`1-8` left, `9-16` right).
5. Use knobs `K1-K8` to shape the focused pad sound.
6. Save/load sessions with `Shift + Copy` / `Shift + Menu`.

---

## Simple Manual

### Pads and banks
- Tap a pad to play it and focus it.
- `Step 1-8` = left section banks.
- `Step 9-16` = right section banks.

### Copy and paste
- **Pad copy/paste**: hold `Shift`, tap source pad, tap destination pad.
- **Bank copy/paste**: hold `Shift`, press source `Step`, then destination `Step`.
- **Clear bank**: `Shift + Vol touch + Step`.

### Looper basics
- Press `Loop` to record, then press again to play.
- Press while playing to toggle overdub.
- Double press to stop.
- Double press + hold to erase.
- `Shift + Loop` enables loop-pad mode (top-right pads control loopers).

### MIDI basics
- MIDI In/Out is supported.
- External notes can trigger pads.
- TwinSampler also sends note events when pads are played.

---

## Full Technical Manual

For the complete control reference (detailed button combos, full looper behavior, exact MIDI mapping, browser/session details, and advanced workflows), see:

- [`TECHNICAL_MANUAL.md`](./TECHNICAL_MANUAL.md)
