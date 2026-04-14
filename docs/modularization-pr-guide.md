# TwinSampler modularization PR guide

This guide explains how to raise a pull request (PR) to modularize `twinsampler/ui_chain.js` in the upstream repository:

- Upstream: https://github.com/charlesvestal/schwung/
- Module path in that repo: `modules/overtake/twinsampler/`

## 1) Create a feature branch

```bash
git checkout -b feat/twinsampler-modules
```

## 2) Proposed target structure

Split the current monolithic `ui_chain.js` into focused ES modules:

```text
twinsampler/
  ui.js
  ui_chain.js                # thin bootstrap/import
  src/
    constants.js
    state.js
    midi-routing.js
    leds.js
    looper.js
    browser.js
    sessions.js
    recording.js
    handlers/
      pads.js
      knobs.js
      steps.js
      transport.js
```

## 3) Migration strategy (recommended)

1. **No behavior changes first**: only move code + imports/exports.
2. Move helpers (`clamp`, `clampInt`, slice mapping, constants) to `constants.js` + utility modules.
3. Move state factories (`createLooperState`, slot/bank/session initializers) into `state.js`.
4. Move MIDI decoding + note/CC routing into `midi-routing.js`.
5. Move LED functions + color policy to `leds.js`.
6. Move looper state machine to `looper.js`.
7. Keep `ui_chain.js` as composition root: initialize state and wire handlers.

## 4) Keep PR easy to review

- Commit 1: create module files and copy code (minimal edits).
- Commit 2: switch call sites/imports.
- Commit 3: cleanup dead code and naming.

## 5) Validate before opening PR

Run these in the module directory (or repo root):

```bash
git status
# run any project checks used in your schwung workflow
```

Then manually validate on device/emulator:

- Pads trigger correctly on both sections.
- Step buttons still select banks.
- Shift-layer knobs still map correctly.
- Browser load/save/delete still works.
- Loop-pad mode behavior unchanged.

## 6) Open PR against upstream

1. Push your branch:
   ```bash
   git push -u origin feat/twinsampler-modules
   ```
2. Open:
   `https://github.com/charlesvestal/schwung/compare`
3. Set base branch (usually `main`) and compare branch `feat/twinsampler-modules`.
4. Use a title like:
   `refactor(twinsampler): split ui_chain into focused modules`

## 7) Suggested PR description template

```md
## Summary
- Split `modules/overtake/twinsampler/ui_chain.js` into focused modules under `src/`.
- Kept behavior identical; this is a structural refactor.
- Left `ui_chain.js` as bootstrap/composition entrypoint.

## Why
- Improves maintainability and testability.
- Makes MIDI/LED/looper/session logic easier to reason about.
- Reduces risk for future feature work.

## Validation
- Manual smoke tests on pad triggering, banks, knobs, browser, recording, and looper behavior.

## Follow-ups
- Add targeted tests for looper state transitions and routing helpers.
```

## 8) Optional: split into stacked PRs

If the diff is too large, do 2-3 smaller PRs:

- PR 1: constants + utility extraction.
- PR 2: MIDI/LED/routing extraction.
- PR 3: looper/session/recording extraction.

This usually gets reviewed faster than one large refactor.
