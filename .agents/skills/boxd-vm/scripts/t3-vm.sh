#!/usr/bin/env bash
# Private boxd VMs in Livemap's org that run a T3 server under the caller's own Claude login.
# Usage: t3-vm.sh check | up <name> [--idle 1h] [--keep 2d] [--delete-after <dur>] | connect <name> | pair <name> | serve <name> | status <name> | list | down <name>
set -euo pipefail

ORG="Livemap AG"
SNAPSHOT=t3code
PORT=8000
LABEL=t3-env=1
REPO_URL=https://github.com/livemapai/t3code
BRANCH=livemap
PAIR_DIR=${TMPDIR:-/tmp}; PAIR_DIR=${PAIR_DIR%/}
export PATH="$HOME/.local/bin:$PATH"

die() { echo "error: $*" >&2; exit 1; }
# 90m, 2h, 3d or plain seconds, as seconds.
seconds() {
  case "$1" in
    *[0-9]d) echo $((${1%d} * 86400)) ;; *[0-9]h) echo $((${1%h} * 3600)) ;;
    *[0-9]m) echo $((${1%m} * 60)) ;; *[0-9]s) echo "${1%s}" ;; *[!0-9]* | "") die "not a duration: $1" ;;
    *) echo "$1" ;;
  esac
}
url() { echo "https://$1.boxd.sh"; }
vm() { local name=$1; shift; boxd machine exec "$name" -- bash -lc "$*"; }

check() {
  command -v boxd >/dev/null || die "boxd CLI missing: install it (see SKILL.md, Prerequisites)"
  local auth
  auth=$(boxd auth 2>&1) || die "not signed in to boxd: the user runs 'boxd auth login'"
  grep -q "^${ORG} .*→" <<<"$auth" || die "active boxd org is not '${ORG}': run 'boxd auth switch' and pick it"
  boxd manage integrations list 2>&1 | grep -qE '^claude +personal +connected' ||
    die "Claude is not connected in '${ORG}': the user runs 'boxd manage integrations connect claude'"
  boxd snapshots list 2>&1 | grep -q "^${SNAPSHOT} .*ready" || die "snapshot '${SNAPSHOT}' is not ready in '${ORG}'"
  echo "ok: boxd signed in, org '${ORG}', Claude connected, snapshot '${SNAPSHOT}' ready"
}

# Starts (or restarts) the T3 server on the VM.
serve() {
  local name=$1
  vm "$name" "
    set -e
    . ~/.config/vite-plus/env
    export T3CODE_HOME=/task/t3home
    cd /task/repos/t3code
    pid=\$(ss -H -ltnp 'sport = :${PORT}' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
    [ -z \"\$pid\" ] || { kill \"\$pid\"; sleep 2; }
    mkdir -p \$T3CODE_HOME/userdata
    [ -s \$T3CODE_HOME/userdata/settings.json ] || echo '{\"linkedEnvironmentsEnabled\": true}' > \$T3CODE_HOME/userdata/settings.json
    setsid nohup node apps/server/src/bin.ts serve --host 0.0.0.0 --port ${PORT} --no-browser >/task/t3serve.log 2>&1 < /dev/null &
    for _ in \$(seq 1 60); do
      curl -fs -o /dev/null --max-time 3 http://127.0.0.1:${PORT}/.well-known/t3/environment && break
      sleep 2
    done
    curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:${PORT}/.well-known/t3/environment || { tail -n 30 /task/t3serve.log; exit 1; }
  "
}

up() {
  local name=$1 idle=1h keep=2d hard="" project env_id
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --idle) idle=$2; shift 2 ;; --keep) keep=$2; shift 2 ;; --delete-after) hard=$2; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  check >/dev/null
  # Private on purpose: boxd serves the owner's Claude login only to private machines.
  # Idle timers count network traffic both ways: an open app connection or a running agent turn
  # keeps it awake; standby and hibernation keep memory, so the T3 server wakes with it.
  # --keep is boxd's auto-destroy: it counts from the last start or wake, not from going idle.
  boxd new "$name" --from-snapshot "$SNAPSHOT" --label "$LABEL" \
    --auto-suspend-timeout 600 --auto-hibernate-timeout "$(seconds "$idle")" \
    --auto-destroy-timeout "$(seconds "$keep")" ${hard:+--delete-after "$hard"} >/dev/null
  # A browser check on the public URL would block T3's server-to-server requests.
  boxd machine config set "$name" bot-protection off >/dev/null
  # The snapshot inherits the dispatcher's port-9 lock on the default proxy.
  boxd machine proxy set-port --vm "$name" --port "$PORT" >/dev/null
  vm "$name" "
    set -e
    . ~/.config/vite-plus/env
    cd /task/repos/t3code
    git remote get-url origin >/dev/null 2>&1 || git remote add origin ${REPO_URL}
    git fetch -q origin ${BRANCH}
    before=\$(git rev-parse HEAD:pnpm-lock.yaml)
    git checkout -q -B ${BRANCH} origin/${BRANCH}
    [ \"\$before\" = \"\$(git rev-parse HEAD:pnpm-lock.yaml)\" ] || vp install >/dev/null
  " >/dev/null
  serve "$name"
  # An approval-required link cannot create projects there, so the VM registers its own.
  project=$(vm "$name" ". ~/.config/vite-plus/env; cd /task/repos/t3code; T3CODE_HOME=/task/t3home node apps/server/src/bin.ts project add /task/repos/t3code --title t3code" | grep -oE '[0-9a-f-]{36}' | head -1)
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null --max-time 5 "$(url "$name")/.well-known/t3/environment" && break
    sleep 2
  done
  env_id=$(curl -fsS --max-time 5 "$(url "$name")/.well-known/t3/environment" | grep -oE '"environmentId":"[^"]+"' | cut -d'"' -f4) ||
    die "$(url "$name") does not answer"
  printf '{"name":"%s","url":"%s","environmentId":"%s","projectId":"%s","hibernatesAfterIdle":"%s","deletedAfterLastWake":"%s","deleteAfter":"%s"}\n' \
    "$name" "$(url "$name")" "$env_id" "$project" "$idle" "$keep" "${hard:-none}"
}

# Writes a 30-minute pairing code to a private file; the code itself never reaches stdout.
pair() {
  local name=$1 file="$PAIR_DIR/t3-vm-pair-$1"
  (umask 077; vm "$name" ". ~/.config/vite-plus/env; cd /task/repos/t3code; T3CODE_HOME=/task/t3home node apps/server/src/bin.ts auth pairing create --ttl 30m --label boxd-link --base-url $(url "$name")" |
    grep -E '^(Token|Expires)' >"$file")
  grep -q '^Token:' "$file" || die "no pairing code minted"
  echo "code in $file ($(grep '^Expires' "$file"))"
}

# Opens a t3code://pair link in the desktop app, which asks the user to confirm the host. Its
# standard scopes include access:write, so the link card can then mint its own code there.
connect() {
  local name=$1 pairing_url link
  pairing_url=$(vm "$name" ". ~/.config/vite-plus/env; cd /task/repos/t3code; T3CODE_HOME=/task/t3home node apps/server/src/bin.ts auth pairing create --ttl 10m --label boxd-app --base-url $(url "$name")" |
    sed -n 's/^Pair URL: *//p')
  [ -n "$pairing_url" ] || die "no pairing URL minted"
  link="t3code://pair?pairingUrl=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$pairing_url")"
  if command -v open >/dev/null; then open "$link"; else xdg-open "$link"; fi
  echo "opened the desktop app's pairing prompt for $(url "$name") (valid 10 minutes)"
}

status() {
  local name=$1
  boxd machine get "$name"
  curl -s -o /dev/null -w "public: %{http_code}\n" --max-time 10 "$(url "$name")/.well-known/t3/environment"
}

case "${1:-}" in
  check) check ;;
  up) [ -n "${2:-}" ] || die "usage: up <name> [--idle 1h] [--keep 2d] [--delete-after <dur>]"; shift; up "$@" ;;
  connect) [ -n "${2:-}" ] || die "usage: connect <name>"; connect "$2" ;;
  pair) [ -n "${2:-}" ] || die "usage: pair <name>"; pair "$2" ;;
  serve) [ -n "${2:-}" ] || die "usage: serve <name>"; serve "$2" ;;
  status) [ -n "${2:-}" ] || die "usage: status <name>"; status "$2" ;;
  list) boxd machine list --label "$LABEL" ;;
  down) [ -n "${2:-}" ] || die "usage: down <name>"; boxd machine remove "$2" --confirm; rm -f "$PAIR_DIR/t3-vm-pair-$2" ;;
  *) sed -n 3p "$0"; exit 1 ;;
esac
