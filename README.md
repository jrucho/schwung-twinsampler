# schwung-twinsampler

Twin Sampler is a high-performance "overtake" sampler module designed specifically for the **Schwung** environment on the **Ableton Move**. It features two independent 4x4 pad sections with 16 total banks, offering deep per-pad control, automatic slicing, MIDI looping, and integrated session management.

[![Watch the demo](https://img.youtube.com/vi/dNPo0ITg-AQ/0.jpg)](https://youtu.be/dNPo0ITg-AQ)
▶️ **Watch Demo:** [https://youtu.be/dNPo0ITg-AQ](https://youtu.be/dNPo0ITg-AQ)

---

## 🛠 Installation

Place the `twinsampler` folder in the following directory on your Ableton Move:
`modules/overtake/twinsampler`

### Required Files:
* `dsp.so` & `dsp_core.so` (DSP Engine)
* `ui.js` & `ui_chain.js` (Interface & Logic)
* `module.json`, `help.json`, and `plugin_api_v1.h`
* `dsp_wrapper_monitor.c`

---

## 🚀 Getting Started

1.  **Load the Module:** Press **Shift + Touch Master Knob**, then turn the **Jog Wheel**. Navigate to *Overtake Modules* and select **Twin Sampler**.
2.  **Select a Bank:** Use the **Step Sequencer buttons 1–16**. 
    * Steps 1–8: Left Section
    * Steps 9–16: Right Section
3.  **Load a Sample:** Click the **Jog Wheel** to open the browser, navigate to a `.wav` file, and click again to load.
4.  **Play:** Use the 4x4 pad grids to trigger your sounds.

---

## 🕹 Core Concepts

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

## 🎛 Control Manual

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
    * **Delete + Pad:** Clears audio from a specific pad.
    * **Shift + Delete:** Clears all audio in the focused bank.
* **Capture:** In Source mode, press **Capture** to randomize or rebuild the transient chop map.
* **Undo/Redo:** Press **Undo** for latest edit; **Shift + Undo** for Redo. (This action takes a few seconds. There is no loading screen, so wait a moment while the undo or redo completes.)

---

## 🎙️ Recording & Browsing

### Browsing Samples

- Select a pad or bank, then press the **Jog Wheel** to open the browser.  
- Navigate folders. Sounds preview automatically when selected.  
- Press the **Jog Wheel** again to load the sound.  
- Press **Shift + Jog Wheel** to exit without loading.  

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

## 🔁 MIDI Loopers
Since the standard Move sequencer is unavailable in Overtake mode, Twin Sampler includes its own looper.
* **Single Looper:** Use the **Loop** button. (1st press: Rec, 2nd: Play, 3rd: Overdub). Double-tap to stop. Tap or double to erase.
* **Multi-Looper Mode:** Press **Shift + Loop** to activate the **top-right 4 pads** as independent looper triggers.
    * **Red:** Recording | **Purple:** Playing / standby | **Yellow:** Overdub
* **Quantize:** Press **Shift + Loop button** (or Shift + Looper Pad) to toggle 1/16th note quantization.
* **Erase:** Double tap and hold a looper pad to clear its MIDI notes.
* **Mute:** Press and hold the **Mute** button, then press pads to mute them.  
* **Erase MIDI Notes:** Press and hold the **Erase** button, then press pads to remove their MIDI notes.  
* **Copy Loop Clips:** Press and hold the **Copy** button, then press an empty looper pad.

---

## 💾 Sessions & Saving
* **Save Session:** Press **Shift + Copy** to open the save menu. (K1/K2 to edit name).
* **Quick Save:** Press **Shift + Copy** again while in the menu.
* **Load Session:** Press **Shift + Menu** to browse and load saved sessions.
* **Autosave:** Automatically saves state to `autosave.json` on exit or change.
* **INIT Session:** A clean baseline session that cannot be deleted or overwritten.

---

## ⚠️ Notes
* **Exiting:** Use the **Back** button to exit the module.
* **Audio Routing:** Audio passes through the main Schwung/Move output path.
* **Browser:** Use `Menu` in the browser to cycle load targets: `AUTO`, `SLOT` (force single pad), or `SRC` (force source bank).
