#!/usr/bin/env bash
# Private boxd VMs in Livemap's org that run a T3 server under the caller's own Claude login.
# Usage: t3-vm.sh check | up <name> [ttl] | pair <name> | serve <name> | status <name> | list | down <name>
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
  local name=$1 ttl=${2:-4h} project
  check >/dev/null
  # Private on purpose: boxd serves the owner's Claude login only to private machines.
  boxd new "$name" --from-snapshot "$SNAPSHOT" --delete-after "$ttl" --label "$LABEL" >/dev/null
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
  curl -fsS -o /dev/null --max-time 5 "$(url "$name")/.well-known/t3/environment" || die "$(url "$name") does not answer"
  printf '{"name":"%s","url":"%s","projectId":"%s","deleteAfter":"%s"}\n' "$name" "$(url "$name")" "$project" "$ttl"
}

# Writes a 30-minute pairing code to a private file; the code itself never reaches stdout.
pair() {
  local name=$1 file="$PAIR_DIR/t3-vm-pair-$1"
  (umask 077; vm "$name" ". ~/.config/vite-plus/env; cd /task/repos/t3code; T3CODE_HOME=/task/t3home node apps/server/src/bin.ts auth pairing create --ttl 30m --label boxd-link --base-url $(url "$name")" |
    grep -E '^(Token|Expires)' >"$file")
  grep -q '^Token:' "$file" || die "no pairing code minted"
  echo "code in $file ($(grep '^Expires' "$file"))"
}

status() {
  local name=$1
  boxd machine get "$name"
  curl -s -o /dev/null -w "public: %{http_code}\n" --max-time 10 "$(url "$name")/.well-known/t3/environment"
}

case "${1:-}" in
  check) check ;;
  up) [ -n "${2:-}" ] || die "usage: up <name> [ttl]"; up "$2" "${3:-}" ;;
  pair) [ -n "${2:-}" ] || die "usage: pair <name>"; pair "$2" ;;
  serve) [ -n "${2:-}" ] || die "usage: serve <name>"; serve "$2" ;;
  status) [ -n "${2:-}" ] || die "usage: status <name>"; status "$2" ;;
  list) boxd machine list --label "$LABEL" ;;
  down) [ -n "${2:-}" ] || die "usage: down <name>"; boxd machine remove "$2" --confirm; rm -f "$PAIR_DIR/t3-vm-pair-$2" ;;
  *) sed -n 3p "$0"; exit 1 ;;
esac
