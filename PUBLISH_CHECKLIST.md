# Schwung Module Store Release — v0.4.0

TwinSampler is already listed in the live Schwung catalog. Its entry uses
`jrucho/schwung-twinsampler`, branch `main`, and `twinsampler-module.tar.gz`.
The repository's `release.json` supplies the versioned update URL.

## Before publication

1. Run `bash scripts/test.sh` and `bash scripts/build.sh`.
2. Verify the package includes every UI `.mjs` file and an ARM64 `dsp.so`
   rebuilt from the current wrapper source.
3. Confirm `twinsampler/module.json`, `src/module.json` and `release.json`
    all say `0.4.0`. The release URL must end in
    `/releases/download/v0.4.0/twinsampler-module.tar.gz`.
4. Keep the local/device 0.3.8 backups until device acceptance is complete.
5. On Schwung 1.7.3, test real sessions: all banks, loop/one-shot levels,
   recording, loopers, editors, save/reload, undo/redo and suspend/resume.
6. Confirm project loading shows progress and pad response is stable after
   startup's `READY`. Record actual opening times separately from mock counts.
7. Review `CHANGELOG.md`, `RELEASE_NOTES.md` and `DEVELOPMENT_REVIEW.md`.

## Publication

1. Inspect status, diff and recent history; stage the intended source/docs/tests.
2. Commit the release and push tag `v0.4.0` first. The **Release Module** action
   validates matching metadata, runs the checks, builds ARM64 and creates a draft
   release with curated notes, the module archive and its SHA-256 checksum.
3. Confirm the action succeeds; download and inspect the draft archive. It must
   extract to `twinsampler/module.json` with version `0.4.0` and all runtime files.
4. Publish the completed release as latest, then push `main`. This makes the
   versioned asset available before the store's `release.json` pointer changes.
5. Confirm public `release.json`, the release tag, module metadata, downloaded
   archive and checksum agree.
6. Check the existing Schwung catalog entry before proposing any catalog PR;
   avoid adding a duplicate. `min_host_version` is a host requirement, not the
   TwinSampler release version.
