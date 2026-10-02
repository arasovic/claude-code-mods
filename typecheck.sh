#!/usr/bin/env bash
# Type-checks the mods: ./typecheck.sh [mod...], all of them when none is named.
# The engine writes .claude-plugin/types only when it loads a mod from its own folder;
# a marketplace install loads the cache copy. So the types get laid here when they are
# missing or were written by another Claude Code build.
set -euo pipefail
cd "$(dirname "$0")"
build=$(claude --version | cut -d' ' -f1)
if [ $# -eq 0 ]; then set -- */; fi
status=0
for mod in "$@"; do
  mod=${mod%/}
  [ -f "$mod/tsconfig.json" ] || continue
  if [ "$(head -1 "$mod/.claude-plugin/types/claude-code/index.d.ts" 2>/dev/null)" != "// Written by Claude Code $build." ]; then
    # /cost runs locally: loading the mod for it lays the types without a model call.
    claude -p --plugin-dir "$PWD/$mod" /cost >/dev/null
  fi
  echo "== $mod"
  npx -y -p typescript tsc -p "$mod" --noEmit || status=1
done
exit $status
