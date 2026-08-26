#!/usr/bin/env bash
# =====================================================================
# Distribute shared assets into every app.
#
#   ./shared/sync.sh
#
# There is no build step, so each app under apps/ needs its own physical
# copy of the stylesheet, the client and the shared scripts. This script
# is that step, run by hand. It is the reason tokens.css and the rest
# must be edited in shared/ and nowhere else: every destination below is
# overwritten without asking.
#
# Run it after any change to shared/, then re-run the tests. The
# pre-commit hook blocks a commit where shared/ and apps/ disagree.
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

copy() { mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "  $2"; }

echo "Inspection app:"
copy "$HERE/tokens.css"          "$ROOT/apps/inspect/tokens.css"
copy "$HERE/inspect.css"         "$ROOT/apps/inspect/styles.css"
copy "$HERE/supabase.js"         "$ROOT/apps/inspect/supabase.js"
copy "$HERE/logo.js"             "$ROOT/apps/inspect/logo.js"
copy "$HERE/changelog.js"        "$ROOT/apps/inspect/changelog.js"
copy "$HERE/vendor-supabase.js"  "$ROOT/apps/inspect/vendor/supabase.js"

echo
echo "Done. The tests load these same files from apps/, substituting only"
echo "config.js and vendor/supabase.js from test/fixtures/ — so there is no"
echo "second copy of the app to keep in step."
