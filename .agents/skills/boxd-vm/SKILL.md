---
name: boxd-vm
description: Run T3 Code work on private boxd VMs in Livemap's org, under the user's own Claude login, connected to the user's app and optionally linked so agents here can delegate to them. Use when the user wants one or more boxd VMs, cloud machines, or to delegate work off this machine; also to list or tear down those VMs.
---

# boxd VMs for T3 Code

Each VM is restored from the `t3code` snapshot, stays **private** to the user who made it, and runs
a T3 server on `https://<name>.boxd.sh`. boxd serves the owner's own Claude Code login to their
private machines, so agent turns there bill the user's own Claude subscription. `scripts/t3-vm.sh`
(in this skill's folder) does all boxd work; run it from the repository root as
`.agents/skills/boxd-vm/scripts/t3-vm.sh`.

Two ways in, and the user picks by what they want:

- **Connected** (step 3): the VM shows in their app with its threads, they can start threads there,
  and Settings → Environments → Load balancing can spread new threads across machines.
- **Linked** (step 4, on top): agents here can also delegate tasks to it.

## Steps

For several VMs, run each step for all of them before the next; `up` runs in parallel.

1. **Check.** Run `t3-vm.sh check`. Done when it prints `ok:`. Each failure names its fix; see
   [Prerequisites](#prerequisites) for who does it.
2. **Up.** Run `t3-vm.sh up <name>`. Pick a short name like `t3-<user>-<task>`. Done when it
   prints JSON with `url`, `environmentId` and `projectId`; keep all three. It takes about a minute.
   See [Sleep and deletion](#sleep-and-deletion) for its options.
3. **Connect.** Run `t3-vm.sh connect <name>`. It opens a `t3code://pair` link, and the desktop app
   asks the user to confirm the host; the link stays valid 10 minutes. Tell the user to confirm it.
   Done when the user confirms. Without the desktop app (web or mobile only), use the
   [pairing code fallback](#pairing-code-fallback) in their Settings → Environments → Add
   environment instead.
4. **Link**, when the user wants agents here to delegate there. Call `t3_environment_link` with
   `environmentId` from step 2 (an address alone makes the card ask for a code). The connected app
   makes the code itself, so the user only approves. Done when the link outcome message arrives.
5. **Verify.** Call `orchestrator_capabilities` with the `environmentId`. Done when `claudeAgent`
   has `canRunChildTask: true` and no constraints.
6. **Delegate.** Call `delegate_task` with `target.environmentId`, `target.projectId` from step 2,
   and `target.providerInstanceId: "claudeAgent"`. Match the model to the work and the user's
   budget; Haiku for smoke tests.
7. **Tear down** when the user is finished: `t3_environment_unlink` with the `environmentId` if it
   was linked, then `t3-vm.sh down <name>`. Done when `t3-vm.sh list` no longer shows it. The app
   keeps a saved entry for it, which the user removes in Settings → Environments.

`t3-vm.sh list` shows the user's VMs from this skill; `status <name>` shows one, with whether its
URL answers; `serve <name>` restarts its T3 server after a reboot.

### Sleep and deletion

A VM sleeps and deletes itself on its own; pass these to `up` only when the user wants otherwise:

- **Standby** after 10 minutes without network traffic, then **hibernated** after `--idle`
  (default `1h`). Both keep its memory, so the T3 server is still running when the first request
  wakes it, in about a second. An open app connection or a running agent turn is traffic and keeps
  it awake; a link alone is not.
- **Deleted** `--keep` (default `2d`) after it last started or woke. The count runs while it is
  awake too, so raise it for a VM someone works in for days on end.
- `--delete-after <dur>` adds a hard deletion time whatever its state, for throwaway tests.
- Work with no network traffic for longer than `--idle` (a long local build) gets hibernated
  mid-work; raise `--idle` for it, or `--idle 0` to never sleep.

### Pairing code fallback

`t3-vm.sh pair <name>` writes a 30-minute code to a private file and prints the file's path. The
user pastes its `Token:` line where a code is asked for; on macOS,
`grep '^Token:' <file> | sed 's/^Token: *//' | tr -d '\n' | pbcopy` puts it on their clipboard.
The code stays in the file and the clipboard. Mint a new one when it expires.

## Prerequisites

`check` covers the boxd side. The user does the sign-ins, since each needs their browser:

- **boxd CLI.** Download `https://boxd.sh/downloads/install.sh`, read it, then run it with stdin from
  `/dev/null`, which installs only the binary to `~/.local/bin`.
- **Signed in:** the user runs `boxd auth login`.
- **Org:** the active org is `Livemap AG`; the user switches with `boxd auth switch`. The `t3code`
  snapshot lives there, so they need membership.
- **Claude connected:** the user runs `boxd manage integrations connect claude` once (or the Claude
  Code card on app.boxd.sh/integrations) and pastes the code claude.ai gives them. It is personal:
  served only to their own private machines, never to teammates or shared machines.
- **This machine:** Settings → Labs → Linked environments is on.

## Rules and why

- **Private only.** Sharing a VM wipes the agent logins on it, and boxd serves none to shared
  machines, so a shared VM has no working provider.
- **Connecting and linking go through the app.** `t3 environment link` opens the local database
  directly, which belongs to the running live server.
- **The VM answers on the public internet** with bot protection off (boxd's browser check blocks
  T3's server-to-server calls). Pairing is the only gate: keep codes out of chat, tear down when
  done.
- **Links below full access** cannot create projects or change settings on the VM. `up` registers
  the checkout as a project from inside the VM for that reason; changing VM settings goes through
  `boxd machine exec <name> -- ...` the same way.
- **Scope.** The VM has the `livemap` branch of this repository at `/task/repos/t3code`, refreshed
  by `up`, with dependencies installed. Git pushes from the VM need the user's
  `boxd manage integrations connect git`; without it, bring results back as the task's reply or a
  patch. Codex works the same way after `boxd manage integrations connect codex`.
