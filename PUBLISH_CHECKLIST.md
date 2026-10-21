# Schwung Module Store Release — v0.4.1

TwinSampler is already listed in the live Schwung catalog. Its entry uses
`jrucho/schwung-twinsampler`, branch `main`, and `twinsampler-module.tar.gz`.
The repository's `release.json` supplies the versioned update URL.

## Before publication

1. Run `bash scripts/test.sh` and `bash scripts/build.sh`.
2. Verify the package includes every UI `.mjs` file and an ARM64 `dsp.so`
   rebuilt from the current wrapper source.
3. Confirm `twinsampler/module.json`, `src/module.json` and `release.json`
    all say `0.4.1`. The release URL must end in
    `/releases/download/v0.4.1/twinsampler-module.tar.gz`.
4. Keep the local/device 0.3.8 backups until device acceptance is complete.
5. On Schwung 1.7.3, test real sessions: all banks, loop/one-shot levels,
   recording, loopers, editors, save/reload, undo/redo and suspend/resume.
6. Confirm project loading shows progress and pad response is stable after
   startup's `READY`. Record actual opening times separately from mock counts.
7. Review `CHANGELOG.md`, `RELEASE_NOTES.md` and `DEVELOPMENT_REVIEW.md`.

## Publication

1. Inspect status, diff and recent history; stage the intended source/docs/tests.
2. Commit the release, push `main`, then push tag `v0.4.1`. The **Verify Release
   Module** action validates matching metadata, runs the checks, builds ARM64 and
   uploads a verification artifact. It deliberately does not publish a release.
3. Confirm the action succeeds. Its artifact must extract to `twinsampler/module.json`
   with version `0.4.1` and pass the GLIBC <= 2.35 check plus the actual ARM64 DSP
   audio probes under QEMU. This proves the sources build; it is not the asset.
4. Install the local `dist/twinsampler-module.tar.gz` on Move and check pad sound.
   Compare every installed runtime file against the extracted archive. Check P1 at
   a nonzero start past five seconds, Trim/CHOP map switching, held-source
   envelope/gain edits, shifted bank sound knobs, the trim-audition toggle and
   armed-recording monitor level.
5. Publish the release as latest by uploading that **Move-verified archive and its
   matching checksum** (for 0.4.1: SHA-256
   `40bb94802d4fe4e55dd382f971439584146cf5bf4f24e185f970ddc735cafe88`), using
   `RELEASE_NOTES.md` as the body. Never upload a separately rebuilt archive:
   compiler and tar metadata differences change its bytes.
6. Confirm public `release.json`, the release tag, module metadata, the downloaded
   archive and checksum agree, then re-verify the downloaded archive against Move.
   If an asset is replaced, replace its checksum with the checksum of that exact file.
6. Check the existing Schwung catalog entry before proposing any catalog PR;
   avoid adding a duplicate. `min_host_version` is a host requirement, not the
    TwinSampler release version.

## Build compatibility

Release CI is pinned to Ubuntu 22.04 (ARM64 glibc 2.35). The original 0.4.0
workflow used Ubuntu 24.04 via `ubuntu-latest`, installing glibc 2.39 cross
libraries. Rebuilding against those libraries reproduced `GLIBC_2.38 not found`
on Move, whose runtime is glibc 2.35. The earlier tests checked architecture
and native wrapper logic but did not load/render the packaged ARM64 DSP.
`scripts/verify-package.mjs` now rejects incompatible runtime requirements,
and the release workflow tests the extracted archive before uploading it.
