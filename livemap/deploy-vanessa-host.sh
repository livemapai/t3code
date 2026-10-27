#!/usr/bin/env bash
# Runs on Vanessa's server as user t3; livemap/deploy-vanessa.sh pipes it over ssh.
#   install <version> <archive>       back up userdata, unpack the runtime, switch t3code.service
#   rollback <version> <backup-dir>   restore that backup and switch the service back to <version>
set -euo pipefail

export XDG_RUNTIME_DIR=/run/user/$(id -u) T3CODE_HOME=$HOME/.t3
versions=$T3CODE_HOME/runtime/versions
bin=$HOME/.local/bin

active_version() {
  sed -n 's/.*"activeVersion": *"\([^"]*\)".*/\1/p' "$T3CODE_HOME/runtime/service-state.json"
}

# A recorded launcher keeps a runtime from being pruned: servers prune every runtime
# that no launcher, process, or service state references when they start.
pin_runtime() {
  local version=$1 launcher=$bin/t3-$1
  ln -sfn "$versions/$version/t3" "$launcher"
  grep -qxF "$launcher" "$T3CODE_HOME/runtime/launchers" 2>/dev/null ||
    printf '%s\n' "$launcher" >> "$T3CODE_HOME/runtime/launchers"
}

check() {
  local version=$1 i
  for i in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3773/)" = 200 ]; then break; fi
    sleep 1
  done
  systemctl --user is-active t3code.service ari-relay-listen.service t3-pair-broker.service
  grep -q "\"serverVersion\":\"$version\"" "$T3CODE_HOME/userdata/server-runtime.json" ||
    { echo "server-runtime.json does not report $version" >&2; return 1; }
  echo "t3code.service serves $version on 127.0.0.1:3773"
}

cmd_install() {
  local version=$1 archive=$2 previous stamp backup staging
  previous=$(active_version)
  [ "$previous" != "$version" ] || { echo "Already running $version."; return; }
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=$HOME/t3-backups/$stamp-$previous-to-$version

  # A consistent copy of the live database through SQLite's backup API; the rest copied as is.
  mkdir -p "$HOME/t3-backups" && mkdir -m 700 "$backup"
  cp -a "$T3CODE_HOME/userdata" "$backup/userdata"
  rm -f "$backup"/userdata/statev2.sqlite*
  python3 -I - "$T3CODE_HOME/userdata/statev2.sqlite" "$backup/userdata/statev2.sqlite" <<'PY'
import sqlite3, sys
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
source.backup(target)
assert target.execute("pragma integrity_check").fetchone()[0] == "ok"
target.close(); source.close()
PY
  cp -a "$T3CODE_HOME/runtime/service-state.json" "$T3CODE_HOME/runtime/launchers" "$backup/"
  cp -a "$HOME/.config/systemd/user/t3code.service" "$backup/"
  readlink "$bin/t3" > "$backup/t3-launcher-target"
  echo "Backed up userdata to $backup"

  # Same layout and sentinel as the upstream installer, so `t3 service install` reuses it.
  if [ "$(cat "$versions/$version/.install-complete" 2>/dev/null)" != "$version" ]; then
    staging=$(mktemp -d "$versions/.staging-XXXXXX")
    tar -xzf "$archive" -C "$staging" --strip-components=1
    "$staging/t3" --version | grep -qx "t3 v$version"
    printf '%s\n' "$version" > "$staging/.install-complete"
    rm -rf "${versions:?}/$version"
    mv "$staging" "$versions/$version"
  fi

  pin_runtime "$previous"
  ln -sfn "$versions/$version/t3" "$bin/t3"
  # Stops the service, records the new active version, rewrites the unit, starts it again.
  "$versions/$version/t3" service install
  check "$version"
  rm -f "$archive"
  echo "Rollback: livemap/deploy-vanessa.sh rollback $previous $backup"
}

cmd_rollback() {
  local version=$1 backup=$2 current
  current=$(active_version)
  [ -f "$versions/$version/.install-complete" ] || { echo "$versions/$version is gone; reinstall it first." >&2; exit 1; }
  [ -f "$backup/userdata/statev2.sqlite" ] || { echo "No database in $backup." >&2; exit 1; }
  pin_runtime "$current"
  systemctl --user stop t3code.service
  # The newer server may have migrated the database, so the whole userdata goes back; the
  # rolled-back copy stays next to it.
  mv "$T3CODE_HOME/userdata" "$T3CODE_HOME/userdata.from-$current-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$backup/userdata" "$T3CODE_HOME/userdata"
  ln -sfn "$versions/$version/t3" "$bin/t3"
  "$versions/$version/t3" service install --allow-downgrade
  check "$version"
}

command=$1; shift
case "$command" in
  install | rollback) "cmd_$command" "$@" ;;
  *) echo "usage: $0 install <version> <archive> | rollback <version> <backup-dir>" >&2; exit 2 ;;
esac
