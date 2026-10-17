#!/usr/bin/env sh
# check-syntax.sh - parse every app module as an ES module (node --check alone treats .js as a script).
cd "$(dirname "$0")/.."
fail=0
for f in $(find app -name '*.js'); do node --input-type=module --check < "$f" 2>/dev/null || { echo "syntax: $f"; node --input-type=module --check < "$f"; fail=1; }; done
exit $fail
