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
- `livemap` is the repo's default branch.
- Vanessa's T3 server runs a build of `livemap`. `livemap/deploy-vanessa.sh build` cross-builds the
  upstream release archive for linux-x64 on a Mac, and `install <archive>` backs up userdata,
  switches `t3code.service`, and prints the matching `rollback` command. The previous runtime stays
  installed for rollback.

## Releases

Every push to `livemap` runs `.github/workflows/livemap-release.yml` and publishes the repo's
latest GitHub Release: the signed macOS arm64 app, the Linux x64 app, and the CLI archives for
macOS arm64 and Linux x64. It reuses upstream's `release-desktop.yml` for packaging.

- Our build has upstream's app identity and `~/.t3`, so it installs over the official app and
  keeps threads and settings. From then on the app updates from this repo's latest release.
  `t3 update` and `scripts/install.sh` read the same release (`packages/shared/src/cliRelease.ts`).
- Versions are `<upstream's newest stable + 1 patch>-livemap.<commit count>`, so each build
  outranks the upstream release it is based on and the one before it.
- It is signed with Livemap's Developer ID (repo secrets `CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`). Unsigned macOS builds cannot
  update themselves. Passkeys are off (`T3CODE_MACOS_PASSKEYS=off`): their provisioning profile
  needs upstream's Apple team, so T3 Connect passkey sign-in does not work in our build.
- Only `livemap-release.yml` should be enabled under Actions. Upstream's workflows are disabled with
  `gh workflow disable`; disable any new one a sync brings in.
