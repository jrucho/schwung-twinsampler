# schwung-twinsampler

`TwinSampler` is an overtake sampler module for Schwung on Ableton Move.

It provides two independent 4x4 pad sections (left/right), each with 8 banks, with full per-pad control, source slicing mode, recording, session management, undo/redo, and autosave.

[![Watch the video](https://img.youtube.com/vi/dNPo0ITg-AQ/0.jpg)](https://youtu.be/dNPo0ITg-AQ)

▶️ Watch demo: https://youtu.be/dNPo0ITg-AQ

## Essential Keys (read this first)

- `Jog click`: open/confirm in browser.
- `Jog turn`: browse items or adjust main value.
- `Step 1-16`: banks (1-8 left section, 9-16 right section).
- `K1-K8`: pad/bank parameters (attack, decay, trim, mode, pitch, gain, loop).
- `Copy` (main): toggle velocity mode (`Velocity Sens ON` / `Full Velocity ON`).
- `Rec`: arm/start/stop recording cycle.
- `Shift + Loop`: toggle loop-pad mode.
- `Shift + Copy`: session save menu.
- `Shift + Menu`: session load menu.

### Loop pad mode (v0.1)

- `Shift + Loop`: toggle loop-pad mode ON/OFF.
- In loop-pad mode, the **top-right 4 pads** are reassigned as looper selectors/triggers (4 independent loopers).
- In loop-pad mode, those 4 pads no longer trigger sampler voices; all other pads behave normally.
- Looper pad LED states:
  - off = no color
  - recording = red
  - playing = green
  - overdub = orange
- Looper pad press behavior matches loop button behavior for the selected looper, including:
  - record -> play -> overdub -> play
  - double press to stop
  - double press and hold to erase
- `Shift + looper pad` in loop-pad mode: toggle quantize ON/OFF for that looper's recorded note events (1/16 grid).

### Main screen legend

- `L:SRC B1  R:PAD B1` = left/right section mode + current bank.
- `F:S1B1P1` = current focus (Section/Bank/Pad).
- `C16 T50` = chop count and transient sensitivity.
- Footer `Loop1:PLAY` = active looper number + state (`OFF/REC/PLAY/OVD/STOP`).

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

## Quick Start

1. Press `Jog click` to open the sample browser.
2. Load a WAV file.
3. Play pads on left/right 4x4 sections.
4. Use `Step 1-16` to select banks (`1-8` left, `9-16` right).
5. Edit pad/chop parameters with `K1-K8`.
6. Save/load sessions with `Shift+Copy` / `Shift+Menu`.

## Core Concepts

### Two sections
- Section 1: left 4 columns of pad matrix.
- Section 2: right 4 columns of pad matrix.

### Eight banks per section
- Each section has banks `1-8`.
- Bank selection is independent per section.

### Two playback modes per section
- `Source` mode: one source sample per bank, fixed 16 chops across pads.
- `Per-Pad` mode: each pad slot can have its own sample.

### Focused target
- Tapping a pad sets focus: section, bank, slot.
- Most edits apply to focused pad or focused bank depending on control context.

## Control Manual

### Main Navigation

- `Jog click`:
- In main view: opens sample browser.
- In browser: selects/enters item.
- With `Shift` in browser: close browser.
- With `Shift+Vol touch`: opens session load browser.
- `Back`:
- Back alone: sends TwinSampler to background (keeps audio running).
- `Shift + Vol touch + Back`: exits module cleanly.

- `Jog turn`:
- In main view: record max length (seconds).
- In browser: scroll list.
- With `Shift` in main view: switch focused section mode (`Source` / `Per-Pad`).

### Pads

- Normal pad tap:
- Triggers sound.
- Sets focused section/slot.

- `Shift + pad` (slot copy workflow):
- First pad tap = copy source slot.
- Second pad tap = paste slot settings to destination.
- Release `Shift` to clear copy arm.

### Step Buttons (Bank control)

- `Step 1-8`: select left section bank 1-8.
- `Step 9-16`: select right section bank 1-8.

- `Shift + Step`:
- First step press = set bank copy source.
- Second step press = copy source bank to destination bank.

- `Shift + Vol touch + Step`:
- Clear/reset that destination bank content.
- Bank color is preserved.

### Knobs: Normal Edit (Main view)

Default scope is pad (`P`).

- `K1`: Attack
- `K2`: Decay
- `K3`: Start trim
- `K4`: End trim
- `K5`: Trigger/Gate toggle
- `K6`: Pitch
- `K7`: Gain
- `K8`: Loop mode
- Trim detail: `K3/K4` now use fine trim by default; hold `Shift` while turning for coarse trim.

### Knobs: Shift Edit Layer (Main view, no Vol touch)

- `Shift + K1`: all slots attack (focused bank)
- `Shift + K2`: all slots decay (focused bank)
- `Shift + K3`: all slots start trim (focused bank)
- `Shift + K4`: all slots end trim (focused bank)
- `Shift + K5`: all slots trig/gate (focused bank)
- `Shift + K6`:
- In `Source` mode: focused source-bank pitch (applies to all chops/slots in bank)
- In `Per-Pad` mode: global pitch
- `Shift + K7`: all slots gain (focused bank)
- `Shift + K8`: all slots loop mode (focused bank)

### Knobs: Shift + Vol Touch Layer

- `Shift + Vol touch + K1`: color mode (`Clean`, `Crunch 12`, `Punch 16`, `Dusty 26`, `Vintage 26`)
- `Shift + Vol touch + K2`: color bit depth
- `Shift + Vol touch + K3`: color sample rate
- `Shift + Vol touch + K4`: color drive+compression (one-knob macro)
- Touching `K1..K4` while holding `Shift + Vol touch` shows current value immediately (no turn needed).
- Turning `K1` (mode) now loads mode defaults right away (bit depth/rate/drive/noise/tone/comp).
- `Shift + Vol touch + K5`: toggle edit scope (`Pad` / `Bank`)
- `Shift + Vol touch + K6`: propagate focused source bank to all banks in focused section
- `Shift + Vol touch + K7`: bank color
- `Shift + Vol touch + K8`: pad color

### Scope Behavior

When scope is `Bank` (`G`) in normal (non-shift) knob page:
- `K1-K4`: all-pad attack/decay/start/end
- `K5`: all-pad trig/gate
- `K6`: global pitch
- `K7`: global gain
- `K8`: all-pad loop

When scope is `Pad` (`P`), knobs edit focused slot only.
Pressing a pad in normal mode re-focuses scope to `Pad` to keep knob edits locked to the selected pad.

### Transport / Utility Buttons

- `Copy` (no shift, main view): toggle `Velocity Sens ON` / `Full Velocity ON`.
- Default on fresh first launch is `Full Velocity ON`.
- `Capture` (main view): randomize transients/chop starts for focused source bank.
- `Shift + Vol touch + Copy` (main view): same transient randomize shortcut.

- `Delete`:
- In main view: clear focused pad audio.
- In browser samples view: delete selected `.wav` file.
- In browser sessions view: delete selected session file.

- `Shift + Delete` (main view): clear all audio in focused bank.

- `Undo`: if looper has a recorded overdub layer, undo that looper layer first; otherwise undo latest edit state.
- `Shift + Undo`: redo latest undone state.

- `Master knob` in REC mode: adjusts line input capture gain.
- `Shift + Master knob` in REC mode: adjusts bus/schwung capture gain.

## Sampler Color Engine (Release 0.1)

TwinSampler includes a real DSP coloration stage (not just UI cosmetics).  
It is designed for classic hardware-style character while keeping controls simple and musical.

### Modes (renamed for release)

- `Clean`: bypass coloration
- `Crunch 12`: gritty 12-bit flavor with moderate high-end rolloff
- `Punch 16`: cleaner 16-bit punch with subtle saturation/noise
- `Dusty 26`: darker, noisier, low-rate texture
- `Vintage 26`: punchy low-bandwidth crunch with tighter top end

### How the color processing works

The DSP color stage runs post-core render and applies:

1. **Resampling behavior**  
   Sample-and-hold style downsampling to emulate reduced playback-rate character.
2. **Tone filtering**  
   One-pole low-pass style smoothing to shape top-end response.
3. **Noise floor**  
   Controlled low-level noise injection for texture.
4. **Saturation/drive**  
   Nonlinear soft clipping for transient rounding and harmonic emphasis.
5. **Bit-depth quantization**  
   Bit reduction/quantization for grain and alias texture.
6. **Wet/dry blend**  
   Final mix control between clean and colored signals.

### Control intent

- K1-K4 under `Shift + Vol touch` are the fast “hardware color” macros for performance.
- The mode selects a tuned preset profile.
- Bit depth / sample rate / drive+comp let you push or tame the preset in real time.
- Color settings are now stored **per bank** and auto-switch when bank changes.

This combination is intended to be release-ready for `0.1`: musical defaults, performable controls, and audible DSP behavior.

### Sample Browser Manual

Open with `Jog click` from main view.

### Behavior

- Shows directories and `.wav` files under:
- `/data/UserData/UserLibrary/Samples`

- WAV preview:
- Highlighting a WAV queues automatic preview playback.
- Preview stops when leaving relevant context.

### Selection

- `Jog click` / `Menu` on directory: enter directory.
- `Jog click` / `Menu` on WAV: load to current target.

### Load target mode

- `Menu` in sample browser cycles target mode:
- `AUTO`: source if section is Source mode, otherwise slot.
- `SLOT`: force load into focused slot.
- `SRC`: force load as focused bank source sample.

### Session System Manual

Sessions are stored in:
- `/data/UserData/UserLibrary/TwinSamplerSessions`

Autosave file:
- `/data/UserData/UserLibrary/twinsampler-autosave-v1.json`

### What a session saves

- Section modes and current banks
- Source paths
- Per-slot sample paths
- Per-slot parameters (attack/decay/trims/gain/pitch/mode/loop)
- Colors (bank + pad)
- Global settings (gain/pitch, velocity, etc.)
- Source slice start map/transient state
- Looper state (`activeLooper`, loop-pad mode, and recorded looper note events/length)
- Looper quantize toggle state and pre-quantize event snapshot (for unquantize toggle recovery)

### Open session menus

- `Shift + Copy`: open session **save** menu (auto name prepared).
- `Shift + Menu`: open session **load** menu.
- `Shift + Vol + Jog click`: open session load menu (legacy shortcut).

### Session browser controls

- `K1`: session name character index
- `K2`: session name character value

- `Menu` / `Jog click`:
- Load selected session.

- `Copy`:
- In save menu: save current name.
- In load menu: copy selected session name to current name field.

- `Shift + Copy`:
- Save current name (quick save while holding shift).

- `Shift + Vol + Copy`:
- Duplicate selected session to next free auto name.

- `Shift + Menu`:
- Rename selected session to current name field.

- `Delete`:
- Delete selected session file.
- Session naming supports auto-increment far beyond 10 (`SESSION01`, `SESSION10`, `SESSION99999`).

### INIT baseline session

- `INIT` session is always ensured on disk.
- `INIT` is a clean baseline for starting from scratch.
- `INIT` is locked:
- cannot be renamed
- cannot be deleted
- cannot be overwritten directly by save

### Autosave

- Most state edits schedule autosave with a short delay.
- Autosave is also written on module exit.

### Startup load order

On init, TwinSampler attempts:
1. autosave
2. named session (`sessionName`)
3. legacy session file (`twinsampler-session-v2.json`)
4. `INIT`
5. otherwise defaults

### Recording

- `Rec` button in main view now works as a 3-step cycle:
1. first press: arm record + enable monitor (LED blinks)
2. second press (while blinking): start recording (monitor remains on)
3. third press: stop recording + disable monitor
- `Shift + Rec` while recording: stop recording, disable monitor, and auto-load the recorded file to the target locked when recording started.
- While recording, wrapper DSP feeds the recorder with `Line In + Schwung audio bus` mixed together when both are active (auto mode).
- In auto mode, if only one source is active, recorder captures that source directly (clean `Line In` or clean `Schwung` bus).
- Mixed capture uses float-domain summing with equal-power dual-source headroom and dithering on int16 handoff to reduce quantization artifacts without limiter coloration.
- Monitoring remains `Line In` only (Schwung bus is added to record path, not monitor path).
- Recording target is focused section/bank/slot.
- In `Source` mode, load target is focused bank source.
- In `Per-Pad` mode, load target is focused slot.
- Record max length is adjusted with `Jog turn` in main view.
- Record LED is solid while recording and blinking while armed.

### Source Mode Details

- Chop count is fixed at 16.
- Source banks use transient-derived slice starts.
- `Capture` randomizes/rebuilds transient slice map.
- Playback uses longer tails for practical trim editing.

## Audio and Routing Notes

- TwinSampler is an `overtake` module (`component_type: overtake`).
- Module audio passes through Schwung/Move output path.
- Schwung master volume and master FX chain are host-level concerns.
- TwinSampler internal loudness trim is available via `Shift + Master knob turn` (module gain).

## Files and Roles

- `module.json`: manifest/capabilities
- `ui.js`: overtake wrapper, exit hook
- `ui_chain.js`: main control/UI/session logic
- `dsp.so`: monitor wrapper DSP (forwards to core + mixes live input when monitor is enabled)
- `dsp_core.so`: original TwinSampler DSP engine binary
- `dsp_wrapper_monitor.c`: wrapper source
- `help.json`: on-device help pages

## Internal Function Map (`ui_chain.js`)

Main runtime:
- `init()`: startup flow, session restore order, DSP sync bootstrap.
- `tick()`: polling, autosave tick, browser preview tick, LED queue drain, draw.
- `onMidiMessageInternal(data)`: top-level control dispatcher.
- `updateRecordButtonLed()`: drives Rec LED for armed blink and recording solid.

Browsers:
- `browserOpen(path, mode)`: opens samples/sessions browser and refreshes entries.
- `browserSelect()`: loads selected sample/session depending on mode.
- `cycleAssignMode()`: sample-browser target cycling (`AUTO/SLOT/SRC`).

Session system:
- `serializeSession()`: builds full persisted session payload.
- `loadSessionFromPath(path, silent, trackHistory)`: load JSON session and apply.
- `saveSessionNamed(silent)`: save current state using current session name.
- `copySelectedSessionToAutoName()`: duplicate selected session to next free name.
- `renameSelectedSessionToCurrentName()`: rename selected session.
- `deleteSelectedSession()`: delete selected session file.
- `ensureInitSessionFile()`: guarantees permanent `INIT` baseline session exists.

History:
- `markSessionChanged()`: marks autosave + history snapshot on edits.
- `undoSessionState()`: undo to previous snapshot.
- `redoSessionState()`: redo previously undone snapshot.

Editing and DSP sync:
- `setSelectedSlice(sliceIdx, ...)`: updates focused section/slot and DSP cursor.
- `ensureEditCursor(blocking)`: syncs edit section/bank/slot to DSP.
- `sendSlotParamCompat(...)`: sends slot params with cursor/direct compatibility path.

Audio/sample operations:
- `setSourcePath(...)`: assign/clear source sample for section/bank.
- `setSlotPath(...)`: assign/clear per-slot sample.
- `randomizeFocusedTransientSlices()`: rebuild source-bank transient chop map.
- `clearFocusedPadAudio()`: erase focused pad sample (or source in source mode fallback).
- `clearFocusedBankAudio()`: erase all slot/source audio for focused bank.

Control layers:
- `handleMainKnob(delta)`: record-length / browser scroll / mode switching behavior.
- `handleParamKnob(cc, delta)`: K1-K8 logic by scope and modifier state.
- `handleStepBankNote(note, velocity)`: bank select/copy/clear actions.
- `handlePadNote(note, velocity)`: play/select pads and Shift copy workflow.

## Troubleshooting

### Parameter seems to update only after bank switch

If a parameter appears stale, update to latest `ui_chain.js` from this repo state. Cursor-sync handling was tightened to avoid stale non-blocking cursor cache.

### Velocity toggle seems to require extra press

Same recommendation: latest `ui_chain.js` includes blocking send for velocity toggle.

### Browser preview works but pad playback does not

1. Confirm module is installed in `modules/overtake/twinsampler`.
2. Confirm you are in the expected section and bank.
3. In `Source` mode, ensure a source sample is loaded.
4. In `Per-Pad` mode, ensure focused slot has a sample.

### Module updates not reflected on device

1. Re-copy the full folder.
2. Remove old duplicate folder versions.
3. Restart Schwung / reload module.

## Notes

- TwinSampler is optimized for Move’s 6-line display and overtake workflow.
- Left and right sections are independent at UI/state level.
- The module may run in a dirty device environment; session files are plain JSON for easy recovery.
