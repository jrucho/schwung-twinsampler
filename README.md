# schwung-twinsampler

Twin Sampler is a high-performance "overtake" sampler module designed specifically for the **Schwung** environment on the **Ableton Move**. It features two independent 4x4 pad sections with 16 total banks, offering deep per-pad control, automatic slicing, MIDI looping, and integrated session management.

[![Watch the demo](https://img.youtube.com/vi/dNPo0ITg-AQ/0.jpg)](https://youtu.be/dNPo0ITg-AQ)

▶️ **Watch demo:** [https://youtu.be/dNPo0ITg-AQ](https://youtu.be/dNPo0ITg-AQ)

▶️ **v0.3.0 - 16 Loopers + Performance FX demo:** https://youtu.be/D_-MyqxISjM?si=ceDgwZSeFdTEcinQ

---

## Installation

Install or update **TwinSampler** from the **Schwung Module Store**. The existing
store entry resolves the published version through this repository's `release.json`.
For manual installation, download `twinsampler-module.tar.gz` from
[the latest release](https://github.com/jrucho/schwung-twinsampler/releases/latest)
and extract it to obtain the `twinsampler` folder.

Place the `twinsampler` folder in the following directory on your Ableton Move:
`modules/overtake/twinsampler`

### Required Files:
* `dsp.so` & `dsp_core.so` (DSP Engine)
* `ui.js`, `ui_chain.js`, `param_transport.mjs`, `waveform.mjs` & `fx_presets.mjs` (Interface & Logic)
* `module.json`, `help.json`, and `plugin_api_v1.h`
* `dsp_wrapper_monitor.c`

---

## v0.4.1: editor performance controls

Shift + K6 pitches all pads in the focused bank from Main, Trim and CHOP.
Without Shift, K6 in either editor still pitches only the selected pad.
Shift + K1/K2/K5/K7/K8 also edits the focused bank's attack, decay/release,
Trigger/Gate, gain and loop. Shift + K3/K4 retains coarse edge adjustment.
Held source-pad edits audition a refreshed voice. Drum one-shot parameters
take effect on the next hit; Gate-mode K2 controls the tail after pad release.
Record works in both editors: press once to arm, again to start, and again to
stop. Shift + Record disarms an armed recording or stops and loads a running one.
Monitoring follows master gain and avoids doubling an input already on Move's bus.

To toggle trim auditioning, **hold Shift, touch the master-volume knob, then
touch K3 once**. The screen shows `Start trim sound ON` or `OFF`. Release the
gesture, hold a pad and turn K3/K4: ON auditions the trim; OFF edits without
starting a new audition. Running loops retain their live-edit behavior.

In CHOP, select P1 and turn K3 to move the first chop's actual start through the
sample, stopping before the next existing cue. Shift + K3 uses 10 ms steps.
Starts beyond five seconds are supported and saved with the manual map.

New samples and recordings start with pad pitch at zero. Global pitch is a
separate, saved project setting that affects every bank, including new imports
and recordings. If everything sounds flat, check Global pitch on Main in Bank
edit scope and return it to 0.0; changing bank pitch does not reset global pitch.
Loading a saved session restores its pitches exactly. Replacing a source sample
resets only that bank's pad settings; replacing a per-pad sample resets only
that pad's settings.
When global pitch is nonzero, pitch feedback shows pad/bank pitch, global pitch
and the effective result, e.g. `P:0.0 G:-2.5 =-2.5`.

### v0.4.0: editors, live chopping and independent grid performance

Version 0.4.0 uses Schwung's optional bulk parameter API
(verified in upstream **v1.7.3**) to reduce startup communication overhead.
Older hosts automatically retain individual parameter writes. File loads,
sample reversal, looping changes and slicing are kept separate from numeric
batches. All 16 banks, 256 pad assignments, effects, cues and final compatibility
replays are still restored before `READY`; no banks or samples are lazy-loaded.

Startup waits while the host reports that the DSP is loading. It also preserves
the saved velocity setting and avoids overwriting autosave if loading is cancelled.
Shift + Back uses the official overtake suspend API when available.
The final startup replays finish before `READY`; no second whole-session replay
is scheduled after the pads become playable. Converted samples are cached on
the data partition, not the small system partition.

### Essential editor pages

| Control | Action |
|---|---|
| Down from main | Open sample waveform/trim |
| Down again, or Shift + Down from main | Open source-bank chop editor (SRC mode) |
| Menu → Sample Editor / Chop Editor | Open an editor directly |
| Tap a pad / turn Jog | Select the slice to edit; pads play through the normal sampler |
| K3 / K4 | Adjust the selected start / end edge |
| K3 on P1 in CHOP | Move the sample start point manually |
| Shift in CHOP | Enable cue marking; does not start or restart audio |
| Shift + pad in CHOP | Mark a cue on the chosen pad; only that pad lights |
| Empty pad in CHOP | Mark a new cue directly during playback, without Shift |
| Plain pad in CHOP | Play that pad's chop with its normal envelope and controls |
| Erase + pad in CHOP | Empty that pad's cue; P1 is not moved and later cues stay put |
| Release Shift | Return to playing chops; existing playback continues |
| Switch bank | Restore that bank's saved Trim or CHOP mode |
| Capture | Randomize the focused source bank's transient chops |
| Shift + K3 / K4 | Coarse 10 ms edge adjustment |
| Shift + master-volume touch + K3 touch | Toggle trim audition sound ON/OFF |
| Shift + K1 / K2 | Bank attack / decay or Gate release |
| Shift + K5 | Bank Trigger/Gate mode |
| Shift + K6 | Pitch the focused bank; plain K6 pitches the selected pad |
| Shift + K7 / K8 | Bank gain / loop mode |
| Record | Arm / start / stop recording without leaving Trim or CHOP |
| Shift + Record | Disarm, or stop and load the recording |
| Shift + Jog | Zoom 1x–128x around the selected start |
| Left / Right | Change the looper pad view when looper pad mode is active; otherwise scroll the zoomed waveform |
| Press Jog | Open the sample browser for the selected pad/bank, just like main |
| Up | CHOP → Trim → main |
| Down | main → Trim → CHOP (stays at CHOP) |
| Back | Return directly to main |

The other six knobs retain their per-pad controls in the editors. Each source
bank keeps two independent chop maps: the transient/random map used on the main
and Trim screens, and a manual map used only in CHOP. Both maps are saved with
the project. Each bank also remembers whether it was left in Trim or CHOP, and
that mode is saved with the project. CHOP starts with no internal cues: P1 spans
the sample, is lit in the bank color, and P2-P16 stay dark. Play P1 through the
normal sampler, then press Shift + pad during playback to mark a cue and light
that pad. Empty pads can also mark a new cue directly without Shift; marked pads
play their chops, and Shift + pad re-marks an existing cue. Shift alone never
starts a full-file preview. The displayed cue playhead estimates the source
position from the triggered slice, its pitch, reverse and loop settings. Pressing
a pad from main opens its bank's remembered editor. While an editor is open,
the screen follows the last played pad in its bank's mode: right drums show Trim
and left chops show CHOP. This display change never rewrites either bank's saved
mode or unloads the other bank's chop map. Knobs edit the displayed pad;
Shift + pad marks cues in the pressed pad's CHOP bank even when a drum was last
displayed. Erase + pad
empties one cue without shifting later cues. Chop edits
change shared boundaries, including the first and last outer cuts; use Trim to
adjust an individual pad's offsets.
Per-pad sample mode opens Trim rather than modifying an unrelated source bank.
Source chop positions are converted into the core's 44.1 kHz frame domain even
when the WAV on disk is 48 kHz. Waveform overviews are approximate on long files.

Alternating between left-side chops and right-side drums triggers each note
before following its display target, without reopening the editor or reinstalling
chop maps on every hit.
Both banks keep their playback maps ready. Waveform scanning waits briefly after
a hit, and returning to cached waveforms avoids re-reading their WAV headers.

### FX presets and loading screens

On the FX page (Up from main), K1 selects one of five named sounds for the
selected effect; K2–K8 edit its parameters. An asterisk after a preset name
means the settings were edited or came from an older session. Saved FX settings
are preserved until you choose another preset. The Lo-fi stereo channel and
instant DJFX history issues are fixed in 0.4.0.

Project restores show a progress screen through the entire restore. Sample
loads, explicit saves, new/init, undo and redo also show a busy screen before
blocking work starts. Some individual conversions and undo/redo operations can
still hold a frame; loading feedback does not imply the DSP file I/O is threaded.

Run the regression checks with Node.js 22 or newer and a native C compiler:

```sh
bash scripts/test.sh
```

Build an installable archive with:

```sh
bash scripts/build.sh
```

The archive is `dist/twinsampler-module.tar.gz`, with a matching `.sha256` file.
An ARM64 Linux compiler
(`aarch64-linux-gnu-gcc`), ARM64 binutils and Node.js are required to rebuild and
verify the DSP wrapper. Runtime requirements above Move's GLIBC 2.35 are rejected.
Release CI uses Ubuntu 22.04 and renders audio from the extracted archive under
ARM64 emulation before upload. See [DEVELOPMENT_REVIEW.md](DEVELOPMENT_REVIEW.md)
for measurements, compatibility findings and remaining work.
Changes are recorded in [CHANGELOG.md](CHANGELOG.md). This version is developed
locally until publication is explicitly requested.

---

## Getting Started

1.  **Load the Module:** Press **Shift + Touch Master Knob**, then turn the **Jog Wheel**. Navigate to *Overtake Modules* and select **Twin Sampler**.
2.  **Select a Bank:** Use the **Step Sequencer buttons 1–16**. 
    * Steps 1–8: Left Section
    * Steps 9–16: Right Section
3.  **Load a Sample:** Click the **Jog Wheel** to open the browser, navigate to a `.wav` file, and click again to load.
4.  **Play:** Use the 4x4 pad grids to trigger your sounds.

---

## Core Concepts

### Two Independent Sections
The Move’s pad matrix is split into two 4x4 grids:
* **Left Section:** Banks 1–8. Defaults to **Source (SRC)** mode, ideal for chopping.
* **Right Section:** Banks 1–8. Defaults to **Pad (PAD)** mode, ideal for finger drumming.

### Playback Modes
Toggle modes for the focused section by holding **Shift** and turning the **Jog Wheel**.
* **Source Mode (SRC):** Automatically chops a single sample into 16 pads using transient detection. Pads are in a **choke group** (they cut each other off).
* **Pad Mode:** Each of the 16 pads can hold its own individual sample. Choking is disabled.

### Velocity Toggle
* **Copy Button:** Press the main **Copy** button (no shift) to toggle between `Velocity Sens ON` and `Full Velocity` (Fixed 127).

---

## Control Manual

### Parameter Knobs (K1–K8)
When a pad is focused, the eight knobs control:
* **K1:** Attack
* **K2:** Decay
* **K3:** Start Trim (Hold **Shift** for coarse adjustment)
* **K4:** End Trim (Hold **Shift** for coarse adjustment)
* **K5:** Trigger / Gate Toggle
* **K6:** Pitch
* **K7:** Gain
* **K8:** Loop Mode (Off, On, or Ping-pong)

### Shift & Utility Actions
* **Global Bank Edit:** Hold **Shift + Knob** to apply a parameter change to **all pads** in the focused bank.
* **Copy Pad:** Hold **Shift**, tap the source pad, then tap the destination pad.
* **Copy Bank:** Hold **Shift**, press the source **Step button**, then the destination **Step button**.
* **Erase:**
    * **Delete + Pad:** In CHOP, empties that pad's chop cue without shifting later cues; elsewhere it clears audio from a specific pad.
    * **Shift + Delete:** Clears all audio in the focused bank.
* **Capture:** In Source mode, press **Capture** on the main, trim, or chop screen to randomize or rebuild the transient chop map.
* **Undo/Redo:** Press **Undo** for latest edit; **Shift + Undo** for Redo. A loading screen is shown while the operation completes.

---

## Recording & Browsing

### Browsing Samples

- Select a pad or bank, then press the **Jog Wheel** to open the browser.  
- Navigate folders. Sounds preview automatically when selected.  
- Press the **Jog Wheel** again to load the sound.  
- Press **Shift + Jog Wheel** to exit without loading.
- Press **Erase** to erase a sample.

### Sampling Audio

- Make sure your input (**USB-C** or **Line In**) is configured in the Overtake recording area.  

### Standard Recording

- Press the **Record** button. It will blink in monitor mode.  
- Press **Record** again to start recording.  
- The audio is saved in the `recorded` folder.  

### Auto-Map Recording

- Select a Source bank or Pad first.  
- Press **Shift + Record**.  
- The recording is automatically sent to your selected target.  
- In **Source Mode**, it is auto-chopped after recording.  

### Exit Record Mode

- While the Record button is blinking, press **Shift + Record** to cancel.

---

## MIDI Loopers
Since the standard Move sequencer is unavailable in Overtake mode, Twin Sampler includes its own looper.
* **Single Looper:** Use the **Loop** button. (1st press: Rec, 2nd: Play, 3rd: Overdub). Double-tap to stop. Tap or double to erase.
* **Multi-Looper Mode:** Press **Shift + Loop** to activate looper pads.
    * **Page 1:** Top-right row controls **Loopers 1-4**.
    * **Right Arrow:** Pages to **5-8**, then **9-12**, then **13-16**.
    * **After 13-16:** Press **Right Arrow** again to enter full-grid looper takeover on the **left grid** (all 16 loopers available directly).
    * **Right Arrow again:** Moves the full-grid looper takeover to the **right grid**.
    * **Left Arrow (from full-grid):** Returns to paged mode at **13-16** on the top-right row, then steps back pages.
    * **Red:** Recording | **Purple:** Playing / standby | **Yellow:** Overdub
* **Quantize:** Press **Shift + Loop button** (or Shift + Looper Pad) to toggle 1/16th note quantization.
* **Erase:** Double tap and hold a looper pad to clear its MIDI notes.
* **Mute:** Press and hold the **Mute** button, then press pads to mute them.  
* **Erase MIDI Notes:** Press and hold the **Erase** button, then press pads to remove their MIDI notes.  
* **Copy Loop Clips:** Press and hold the **Copy** button, then press an empty looper pad.

---

## Sessions & Saving
* **Save Session:** Press **Shift + Copy** to open the save menu. (K1/K2 to edit name).
* **Quick Save:** Press **Shift + Copy** again while in the menu.
* **Load Session:** Press **Shift + Menu** to browse and load saved sessions.
* **Autosave:** Automatically saves state to `autosave.json` on exit or change.
* **INIT Session:** A clean baseline session that cannot be deleted or overwritten.
* **Erase Session:** Press **Erase** to erase a session.

### Overwrite Existing Session
* **Press Shift + Copy** to open the save menu.
* Select the target session name: Use K1 / K2 to enter the same name manually, or
* Highlight an existing session and **press Copy** to load its name into the name field. (not working right now, feature coming soon)
* **Press Shift + Copy** again to save over that session.

---

## Pad Colours
  
* **Bank Colour:** Press **Shift + Master Volume Touch + Knob 7** to change the current bank colour.
* **Pad Colour:** Press **Shift + Master Volume Touch + Knob 8** to change the current pad colour.

---

## Notes
* **Exiting:** Use the **Back** button to exit the module.
* **Audio Routing:** Audio passes through the main Schwung/Move output path.
* **Browser:** Use `Menu` in the browser to cycle load targets: `AUTO`, `SLOT` (force single pad), or `SRC` (force source bank).

Video explainer:
https://notebooklm.google.com/notebook/31678b7d-3a8e-4d41-8a5f-d2675b3e7298?artifactId=51636e7b-9007-4b6b-887e-5f6fd45da365

Cool presentation cheatsheet/manual: 
https://notebooklm.google.com/notebook/31678b7d-3a8e-4d41-8a5f-d2675b3e7298?artifactId=2e5a2681-70c7-47ee-9dd4-40b7615a7e9f

<img width="1786" height="994" alt="1" src="https://github.com/user-attachments/assets/0309cf14-cbce-4b51-bb64-939a161f1f5b" />

<img width="1789" height="997" alt="2" src="https://github.com/user-attachments/assets/3b55861e-6ce1-48d9-8f66-305a07fdc330" />

<img width="1789" height="996" alt="3" src="https://github.com/user-attachments/assets/514b7eab-24be-4af7-8dbc-777282cda502" />

<img width="1788" height="1000" alt="4" src="https://github.com/user-attachments/assets/61cdb326-001c-4947-85b5-ed524e1d0ed5" />

<img width="1789" height="997" alt="5" src="https://github.com/user-attachments/assets/5c382054-c485-4964-9ab4-edb71773d810" />

<img width="1788" height="1000" alt="6" src="https://github.com/user-attachments/assets/d78905f4-9b73-4268-be50-26177add2d98" />

<img width="1787" height="997" alt="7" src="https://github.com/user-attachments/assets/fcb7850a-f68f-4b41-82e1-b884b6b4f5fb" />

<img width="1787" height="996" alt="8" src="https://github.com/user-attachments/assets/9c52416d-f597-468a-8434-1dc927e48900" />

<img width="1788" height="998" alt="9" src="https://github.com/user-attachments/assets/c91c4bb2-285d-4981-8deb-509b9fa69db1" />

<img width="1787" height="997" alt="10" src="https://github.com/user-attachments/assets/19e6d9da-0ff9-4314-883f-f5f3932d6ed0" />
