---
name: boxd-vm
description: Run T3 Code work on a private boxd VM in Livemap's org, under the user's own Claude login, linked to this environment so agents here can delegate to it. Use when the user wants a boxd VM, a cloud machine, or to delegate work off this machine; also to list or tear down those VMs.
---

# boxd VMs as linked environments

Each VM is restored from the `t3code` snapshot, stays **private** to the user who made it, runs a
T3 server on `https://<name>.boxd.sh`, and is linked here as a linked environment. boxd serves the
owner's own Claude Code login to their private machines, so agent turns there bill the user's own
Claude subscription. `scripts/t3-vm.sh` (in this skill's folder) does all boxd work; run it from the
repository root as `.agents/skills/boxd-vm/scripts/t3-vm.sh`.

## Steps

1. **Check.** Run `t3-vm.sh check`. Done when it prints `ok:`. Each failure names its fix; see
   [Prerequisites](#prerequisites) for who does it.
2. **Up.** Run `t3-vm.sh up <name> [ttl]` (ttl defaults to `4h`, such as `90m` or `1d`). Pick a
   short name like `t3-<user>-<task>`. Done when it prints JSON with `url` and `projectId`; keep
   both. It takes about a minute.
3. **Link.** Run `t3-vm.sh pair <name>`; it writes a 30-minute pairing code to a private file and
   prints that file's path. Call `t3_environment_link` with `url` set to the VM's URL, then tell the
   user to paste the `Token:` line from that file into the card and approve. The code stays in the
   file. Done when the link outcome message arrives with the VM's `environmentId`. A code that
   expired before the user got to it: run `pair` again and send a new card.
4. **Verify.** Call `orchestrator_capabilities` with that `environmentId`. Done when `claudeAgent`
   has `canRunChildTask: true` and no constraints.
5. **Delegate.** Call `delegate_task` with `target.environmentId`, `target.projectId` from step 2,
   and `target.providerInstanceId: "claudeAgent"`. Match the model to the work and the user's
   budget; Haiku for smoke tests.
6. **Tear down** when the user is finished: `t3_environment_unlink` with the `environmentId`, then
   `t3-vm.sh down <name>`. Done when `t3-vm.sh list` no longer shows it. Every VM also deletes
   itself when its ttl runs out.

`t3-vm.sh list` shows the user's VMs from this skill; `status <name>` shows one, with whether its
URL answers; `serve <name>` restarts its T3 server after a reboot.

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
- **Linking goes through the card.** `t3 environment link` opens the local database directly,
  which belongs to the running live server.
- **The VM answers on the public internet** with bot protection off (boxd's browser check blocks
  T3's server-to-server calls). The pairing code is the only gate: keep it in the file, keep ttl
  short, tear down when done.
- **Approval-required links** cannot create projects or change settings on the VM. `up` registers
  the checkout as a project from inside the VM for that reason; changing VM settings goes through
  `boxd machine exec <name> -- ...` the same way.
- **Scope.** The VM has the `livemap` branch of this repository at `/task/repos/t3code`, refreshed
  by `up`, with dependencies installed. Git pushes from the VM need the user's
  `boxd manage integrations connect git`; without it, bring results back as the task's reply or a
  patch. Codex works the same way after `boxd manage integrations connect codex`.
