#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist
LIBS=(-lm)
if [[ "$(uname -s)" == "Linux" ]]; then LIBS+=(-ldl); fi
"${CC:-cc}" -O2 -std=c11 -Wall -Wextra -Wno-unused-function -Wno-unused-parameter \
  tests/dsp_regression.c -o dist/dsp_regression "${LIBS[@]}"
node --test tests/startup.test.mjs tests/waveform.test.mjs
