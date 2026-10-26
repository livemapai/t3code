# Livemap fork of T3 Code

`main` mirrors [pingdotgg/t3code](https://github.com/pingdotgg/t3code) and is never committed to.
`livemap` is upstream plus our changes, and is what the team runs.

- Keep our changes thin. Prefer new files and directories; every edit to an upstream file is a
  future merge conflict.
- Keep the wire compatible with upstream clients. The App Store mobile app and app.t3.codes stay
  upstream, so a server from this fork must not send them anything they would reject.
- Anything generic (for example Limrun device hosts) goes upstream once maintainers approve it in
  an Ideas discussion. ari-specific work stays here.
- `livemap/sync-upstream.sh` mirrors upstream `main` and merges it into `livemap` (merge, not
  rebase, so nobody's checkout is rewritten). Vanessa's Hermes `coder` profile runs it daily at
  07:00 Europe/Zurich (script-only job `t3code_fork_sync.sh`). A clean day stays silent.
- On a conflict nothing is pushed to `livemap`; Tomas gets the details on Slack, and at 06:20 UTC
  Vanessa's conflict job takes over: `t3code_conflict_prepare.sh` merges in a fresh worktree on the
  host, a boxd agent resolves the markers and runs `vp run check:changed`, and
  `t3code_conflict_publish.sh` records a real merge commit on `sync/upstream-<sha>` and opens a PR
  into `livemap`. Tomas reviews and merges it; nothing merges on its own.
- `livemap` is the repo's default branch. GitHub Actions are disabled so upstream's CI and release
  workflows don't run here.
