#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
src=decoder-source/psf2
upstream=$src/audacious
mkdir -p decoder-runtime/vendor/psf2
"${EMXX:-em++}" -O2 -std=c++17 \
  -I"$upstream" -I"$src/compat" -sUSE_ZLIB=1 \
  "$src/ao-host.cpp" "$upstream"/{corlett,eng_psf2,psx,psx_hw}.cc \
  "$upstream/peops/spu.cc" "$upstream"/peops2/{dma,registers,spu}.cc \
  -sMODULARIZE=1 -sEXPORT_NAME=GremlinPsf2 -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=268435456 \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_gremlin_psf2_open,_gremlin_psf2_render \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP16 -sFORCE_FILESYSTEM=1 \
  -o decoder-runtime/vendor/psf2/gremlin-psf2.js
