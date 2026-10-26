#!/bin/sh
# Mirrors upstream main into the fork's mirror branch and merges it into ours.
# Exit 0: up to date or merged. Exit 2: merge conflict, nothing pushed.
# UPSTREAM, UPSTREAM_BRANCH, FORK, MIRROR_BRANCH and OUR_BRANCH can be overridden
# (the Hermes job pushes over HTTPS; a test run points them at throwaway branches).
set -eu

UPSTREAM=${UPSTREAM:-https://github.com/pingdotgg/t3code.git}
UPSTREAM_BRANCH=${UPSTREAM_BRANCH:-main}
FORK=${FORK:-git@github.com:livemapai/t3code.git}
MIRROR_BRANCH=${MIRROR_BRANCH:-main}
OUR_BRANCH=${OUR_BRANCH:-livemap}

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; refusing to sync." >&2
  exit 1
fi

git fetch --quiet "$UPSTREAM" "refs/heads/$UPSTREAM_BRANCH"
upstream=$(git rev-parse FETCH_HEAD)
git push --quiet "$FORK" "$upstream:refs/heads/$MIRROR_BRANCH"

git fetch --quiet "$FORK" "refs/heads/$OUR_BRANCH"
git switch --quiet "$OUR_BRANCH"
git merge --quiet --ff-only FETCH_HEAD

if git merge-base --is-ancestor "$upstream" HEAD; then
  echo "$OUR_BRANCH already contains upstream $(git rev-parse --short "$upstream")."
  exit 0
fi

if git merge --no-edit --quiet -m "chore(livemap): merge upstream main" "$upstream"; then
  git push --quiet "$FORK" "HEAD:refs/heads/$OUR_BRANCH"
  echo "Merged upstream $(git rev-parse --short "$upstream") into $OUR_BRANCH."
else
  echo "Conflicts merging upstream $(git rev-parse --short "$upstream"):" >&2
  git diff --name-only --diff-filter=U >&2
  git merge --abort
  exit 2
fi
