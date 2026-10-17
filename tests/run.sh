#!/usr/bin/env sh
# run.sh - build and run every gate: the C++ service gate, the JavaScript unit tests, the end-to-end
# slice in headless Chromium. Exit non-zero on the first failing stage. Node and Playwright are
# development tools only (DECISIONS.md D-02); the product runs without them.
set -e
cd "$(dirname "$0")/.."
echo "== build"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release > build/cmake.log 2>&1 || (cat build/cmake.log; exit 1)
cmake --build build -j > build/make.log 2>&1 || (cat build/make.log; exit 1)
echo "== service gate"
./build/service-gate | tail -1
echo "== unit tests"
node --test tests/unit/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"
node --test tests/unit/*.test.mjs > /dev/null 2>&1
echo "== end to end"
node tests/e2e/slice.mjs ./build/coral-service | tail -1
