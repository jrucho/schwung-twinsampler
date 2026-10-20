# Schwung Module Store Publish Checklist — v0.3.9

Development remains local until the owner explicitly authorizes publication.
No commit, push, release tag or catalog change is implied by building/installing.

## Before publication

1. Run `bash scripts/test.sh` and `bash scripts/build.sh`.
2. Verify the package includes every UI `.mjs` file and an ARM64 `dsp.so`
   rebuilt from the current wrapper source.
3. Confirm `twinsampler/module.json`, `src/module.json` and `release.json`
   all say `0.3.9`. The planned release URL must end in
   `/releases/download/v0.3.9/twinsampler-module.tar.gz`.
4. Keep the local/device 0.3.8 backups until device acceptance is complete.
5. On Schwung 1.7.3, test real sessions: all banks, loop/one-shot levels,
   recording, loopers, editors, save/reload, undo/redo and suspend/resume.
6. Confirm project loading shows progress and pad response is stable after
   startup's `READY`. Record actual opening times separately from mock counts.
7. Review `CHANGELOG.md` and `DEVELOPMENT_REVIEW.md`; resolve any device failures.

## Only after explicit approval

1. Inspect status, diff and recent history; stage the intended source/docs/tests.
2. Commit and push the approved changes to `jrucho/schwung-twinsampler`.
3. Create and push the release tag `v0.3.9` when release publication is approved.
4. Confirm the **Release Module** action succeeds and the release contains
   `twinsampler-module.tar.gz`, extracting to `twinsampler/module.json`.
5. Confirm the public `release.json` URL downloads the actual release asset.
6. Check the existing Schwung catalog entry before proposing any catalog PR;
   avoid adding a duplicate. `min_host_version` is a host requirement, not the
   TwinSampler release version.
