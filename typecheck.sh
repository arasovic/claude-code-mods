#!/usr/bin/env bash
# Type-checks the mods: ./typecheck.sh [mod...], all of them when none is named.
# The plugin API's types ship inside Claude Code and are not ours to commit, so each run
# takes them from the installed build: loading its plugin-authoring skill writes them,
# even logged out. An empty config dir keeps that call logged out, so it never reaches
# the API, and keeps the types free of this account's tool flags, the same as in CI.
set -euo pipefail
cd "$(dirname "$0")"
build=$(claude --version | cut -d' ' -f1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
touch "$work/start"
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
  CLAUDE_CONFIG_DIR="$work/config" claude -p /plugin-authoring </dev/null >/dev/null 2>&1 || true
types=$(find "/tmp/claude-$(id -u)/bundled-skills/$build" -path '*/plugin-authoring/types/claude-code.d.ts' -newer "$work/start" 2>/dev/null | head -1)
if [ -z "$types" ] || [ "$(head -1 "$types")" != "// Written by Claude Code $build." ]; then
  echo "Claude Code $build wrote no plugin types under /tmp/claude-$(id -u)/bundled-skills" >&2
  exit 1
fi
if [ $# -eq 0 ]; then set -- */; fi
status=0
for mod in "$@"; do
  mod=${mod%/}
  [ -f "$mod/tsconfig.json" ] || continue
  dir=$mod/.claude-plugin/types
  rm -rf "$dir"
  mkdir -p "$dir/claude-code"
  cp "$types" "$dir/claude-code/index.d.ts"
  cat >"$dir/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment",
    "typeRoots": ["."],
    "types": ["claude-code"]
  },
  "include": ["../../hooks", "../../types", "../../tests"]
}
EOF
  echo "== $mod"
  npx -y -p typescript@7.0.2 tsc -p "$mod" --noEmit || status=1
done
exit $status
