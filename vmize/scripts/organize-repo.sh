#!/usr/bin/env bash

# Helper script to move existing top-level project files into `vmize/` and clean up duplicates.
# WARNING: This will move files and may overwrite targets. Review before running.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "This script will move known project folders into $ROOT/vmize/ (if they exist)"
read -p "Proceed? (y/N) " yn
case "$yn" in
  [Yy]*) ;;
  *) echo "Aborted."; exit 1;;
esac

# Move if source exists and target doesn't
move_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -e "$src" ] && [ ! -e "$dst" ]; then
    echo "Moving $src -> $dst"
    mv "$src" "$dst"
  else
    echo "Skipping $src (does not exist or target exists)"
  fi
}

move_if_exists "./backend" "./vmize/backend"
move_if_exists "./frontend" "./vmize/frontend"
move_if_exists "./.github" "./vmize/.github"
move_if_exists "./README.md" "./vmize/README.md"
move_if_exists "./.gitignore" "./vmize/.gitignore"

echo "Done. Verify files in ./vmize/ and delete old copies if desired."