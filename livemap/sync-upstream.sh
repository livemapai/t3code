#!/bin/sh
# Mirrors upstream main into the fork's main and merges it into livemap.
# Exit 0: up to date or merged. Exit 2: merge conflict, nothing pushed.
set -eu

UPSTREAM=https://github.com/pingdotgg/t3code.git
FORK=git@github.com:livemapai/t3code.git

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; refusing to sync." >&2
  exit 1
fi

git fetch --quiet "$UPSTREAM" main
upstream=$(git rev-parse FETCH_HEAD)
git push --quiet "$FORK" "$upstream:refs/heads/main"

git fetch --quiet "$FORK" livemap
git checkout --quiet livemap
git merge --quiet --ff-only FETCH_HEAD

if git merge-base --is-ancestor "$upstream" HEAD; then
  echo "livemap already contains upstream $(git rev-parse --short "$upstream")."
  exit 0
fi

if git merge --no-edit --quiet -m "chore(livemap): merge upstream main" "$upstream"; then
  git push --quiet "$FORK" livemap
  echo "Merged upstream $(git rev-parse --short "$upstream") into livemap."
else
  echo "Conflicts merging upstream $(git rev-parse --short "$upstream"):" >&2
  git diff --name-only --diff-filter=U >&2
  git merge --abort
  exit 2
fi
