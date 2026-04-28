#!/usr/bin/env bash
set -euo pipefail

MODULE_ID="twinsampler"
SOURCE_DIR="twinsampler"
DIST_DIR="dist/${MODULE_ID}"
ARCHIVE_NAME="twinsampler-module.tar.gz"
ARCHIVE_PATH="dist/${ARCHIVE_NAME}"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"
mkdir -p "dist"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Expected source directory '${SOURCE_DIR}' was not found." >&2
  exit 1
fi

cp -R "${SOURCE_DIR}/." "${DIST_DIR}/"

# Build monitor wrapper DSP from source whenever available so packaged module
# always contains a matching dsp.so for current ui/wrapper changes.
if [[ -f "${SOURCE_DIR}/dsp_wrapper_monitor.c" ]]; then
  if command -v gcc >/dev/null 2>&1; then
    gcc -O2 -shared -fPIC \
      -o "${DIST_DIR}/dsp.so" \
      "${SOURCE_DIR}/dsp_wrapper_monitor.c" \
      -I "${SOURCE_DIR}" \
      -ldl -lm
    echo "Built ${DIST_DIR}/dsp.so from ${SOURCE_DIR}/dsp_wrapper_monitor.c"
  else
    echo "Warning: gcc not available; keeping existing dsp.so in package." >&2
  fi
fi

# Optional native DSP build. If the repository contains dsp/ source, compile it
# and place the resulting shared object into the packaged module directory.
if [[ -d "dsp" ]]; then
  echo "dsp/ directory detected; attempting native DSP build"

  if [[ -f "dsp/Makefile" ]]; then
    make -C dsp
  elif [[ -f "dsp/CMakeLists.txt" ]]; then
    cmake -S dsp -B dsp/build
    cmake --build dsp/build --config Release
  fi

  DSP_OUTPUT=""
  while IFS= read -r so_file; do
    DSP_OUTPUT="${so_file}"
    break
  done < <(find dsp -type f -name '*.so' | sort)

  if [[ -n "${DSP_OUTPUT}" ]]; then
    cp "${DSP_OUTPUT}" "${DIST_DIR}/dsp.so"
  else
    echo "Warning: dsp/ exists but no .so output was found; keeping existing module binaries." >&2
  fi
fi

if [[ ! -f "${DIST_DIR}/module.json" ]]; then
  echo "module.json not found in ${DIST_DIR}." >&2
  exit 1
fi

tar -czf "${ARCHIVE_PATH}" -C dist "${MODULE_ID}"

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Failed to create ${ARCHIVE_PATH}." >&2
  exit 1
fi

echo "Build complete: ${DIST_DIR}"
echo "Archive complete: ${ARCHIVE_PATH}"
