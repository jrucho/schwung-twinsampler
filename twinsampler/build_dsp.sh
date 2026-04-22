#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if ! command -v aarch64-linux-gnu-gcc >/dev/null 2>&1; then
  echo "error: aarch64-linux-gnu-gcc not found in PATH" >&2
  exit 1
fi
if ! command -v xxd >/dev/null 2>&1; then
  echo "error: xxd not found in PATH" >&2
  exit 1
fi
if [ ! -f "dsp_core.so" ]; then
  echo "error: dsp_core.so not found (needed to refresh embedded core payload)" >&2
  exit 1
fi

xxd -i dsp_core.so > dsp_core_blob.h

OUT_TMP="dsp.so.new"
aarch64-linux-gnu-gcc \
  -shared -fPIC -O2 -std=c11 \
  -Wall -Wextra -Wno-unused-function -Wno-unused-parameter \
  -o "$OUT_TMP" dsp_wrapper_monitor.c -ldl -lm

if [ -f "dsp.so" ]; then
  cp -f dsp.so "dsp.so.bak_$(date +%Y-%m-%d_%H-%M-%S)"
fi
mv -f "$OUT_TMP" dsp.so

echo "Built $(pwd)/dsp.so"
