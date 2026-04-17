# Schwung Module Store Publish Checklist

## Quick handoff (after these files are merged)
1. Review this checklist and confirm repo files are correct.
2. Run:
   - `git tag v1.0.0 && git push origin v1.0.0`
3. Fork `charlesvestal/schwung` and add the JSON snippet from `CATALOG_ENTRY.md` into `module-catalog.json`.

---

1. **Review changes and commit**
   - Verify `scripts/build.sh`, `.github/workflows/release.yml`, `release.json`, and catalog docs are correct.
   - Commit to `main`:
     - `git add .github/workflows/release.yml scripts/build.sh release.json CATALOG_ENTRY.md PUBLISH_CHECKLIST.md`
     - `git commit -m "chore: add automated release and module-store publishing files"`

2. **Push commit and tag `v1.0.0`**
   - Push the commit:
     - `git push origin main`
   - Create and push the release tag (single command):
     - `git tag v1.0.0 && git push origin v1.0.0`

3. **Wait for GitHub Action release job**
   - Open `Actions` in `jrucho/schwung-twinsampler`.
   - Wait for **Release Module** workflow (triggered by `v1.0.0`) to complete.
   - Confirm artifacts/results:
     - GitHub Release `v1.0.0` exists.
     - Asset `twinsampler-module.tar.gz` is attached.
     - `release.json` on `main` was updated to:
       - `version: "1.0.0"`
       - `download_url: "https://github.com/jrucho/schwung-twinsampler/releases/download/v1.0.0/twinsampler-module.tar.gz"`

4. **Fork Schwung core repo**
   - Fork `charlesvestal/schwung` on GitHub to your account.
   - Clone your fork locally and create a branch (example):
     - `git clone https://github.com/<your-username>/schwung.git`
     - `cd schwung`
     - `git checkout -b add-twinsampler-module`

5. **Add your module to module-catalog.json**
   - Open your module repo’s `CATALOG_ENTRY.md`.
   - Copy the JSON snippet and add it to `module-catalog.json` in the Schwung repo.
   - Ensure JSON syntax remains valid (commas, array/object placement).

6. **Open the catalog Pull Request**
   - Commit the catalog change in your Schwung fork:
     - `git add module-catalog.json`
     - `git commit -m "Add twinsampler module to catalog"`
   - Push branch and open PR to `charlesvestal/schwung:main`:
     - `git push origin add-twinsampler-module`
   - In PR description, include:
     - Link to your release (`v1.0.0`)
     - Link to `release.json` on `main`
     - Confirmation that tarball extracts to `twinsampler/` with `module.json` inside.
