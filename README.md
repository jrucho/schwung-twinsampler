# schwung-twinsampler

Twin Sampler is a high-performance "overtake" sampler module designed specifically for the **Schwung** environment on the **Ableton Move**. It features two independent 4x4 pad sections with 16 total banks, offering deep per-pad control, automatic slicing, MIDI looping, and integrated session management.

[![Watch the demo](https://img.youtube.com/vi/dNPo0ITg-AQ/0.jpg)](https://youtu.be/dNPo0ITg-AQ)

▶️ **Watch demo:** [https://youtu.be/dNPo0ITg-AQ](https://youtu.be/dNPo0ITg-AQ)

▶️ **v0.2.2 - 16 Loopers demo:** https://youtu.be/D_-MyqxISjM?si=ceDgwZSeFdTEcinQ

---

## Installation

Place the `twinsampler` folder in the following directory on your Ableton Move:
`modules/overtake/twinsampler`

### Required Files:
* `dsp.so` & `dsp_core.so` (DSP Engine)
* `ui.js` & `ui_chain.js` (Interface & Logic)
* `module.json`, `help.json`, and `plugin_api_v1.h`
* `dsp_wrapper_monitor.c`

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
    * **Delete + Pad:** Clears audio from a specific pad.
    * **Shift + Delete:** Clears all audio in the focused bank.
* **Capture:** In Source mode, press **Capture** to randomize or rebuild the transient chop map.
* **Undo/Redo:** Press **Undo** for latest edit; **Shift + Undo** for Redo. (This action takes a few seconds. There is no loading screen, so wait a moment while the undo or redo completes.)

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







