#!/usr/bin/env bash
# Builds the self-contained T3 Code CLI archive from this checkout and runs it on Vanessa's server,
# the same artifact and layout upstream's release workflow and installer produce.
#
#   livemap/deploy-vanessa.sh build                  # this clean checkout -> .t3/release-cli/t3-<version>-linux-x64.tar.gz
#   livemap/deploy-vanessa.sh install <archive>      # back up userdata, switch t3code.service, keep the old runtime
#   livemap/deploy-vanessa.sh rollback <version> <backup-dir>
#
# HOST (default vanessa@vanessa-ai) needs passwordless sudo; T3 runs there as user t3.
# VERSION overrides the build's version. The default, <base>-livemap.<commit count>.<sha>, grows
# with every livemap commit so `t3 service install` never sees a new build as a downgrade.
set -euo pipefail

HOST=${HOST:-vanessa@vanessa-ai}
here=$(cd "$(dirname "$0")" && pwd)

# Builds the checkout it runs in, so a newer copy of this script can build an older commit.
build() {
  local root
  root=$(git rev-parse --show-toplevel)
  cd "$root"
  [ -z "$(git status --porcelain)" ] || { echo "Build from a clean checkout; it stamps package versions." >&2; exit 1; }
  export PATH="$HOME/.local/share/vite-plus/bin:$PATH"
  local node_version base version out shim
  node_version=$(node -p 'require("./package.json").engines.node')
  vp env install "$node_version" >/dev/null
  export PATH="$HOME/.local/share/vite-plus/js_runtime/node/$node_version/bin:$PATH"
  # Upstream's package.json lags its releases; like its nightlies, name the release after the newest stable.
  base=$(git tag --merged HEAD --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 |
    awk -F. '{ sub(/^v/, "", $1); print $1 "." $2 "." $3 + 1 }')
  version=${VERSION:-${base:?no stable tag reachable; fetch upstream tags or set VERSION}-livemap.$(git rev-list --count HEAD).$(git rev-parse --short=10 HEAD)}
  out="$root/.t3/release-cli"
  shim=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now; the locals are gone when the trap runs
  trap "git -C '$root' checkout -- . ; rm -rf '$shim'" EXIT

  vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
  node scripts/update-release-package-versions.ts "$version"
  # The public T3 Connect identifiers official builds bake in (see .env.example).
  export T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsudDMuY29kZXMk T3CODE_CLERK_JWT_TEMPLATE=t3-relay \
    T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=hzxSgY2cH10sDU2r T3CODE_RELAY_URL=https://relay.t3.codes
  vp run --filter t3 build
  node scripts/apply-web-brand-assets.ts production apps/server/dist/client
  node apps/server/scripts/cli.ts build-exe --target linux-x64

  # No Rust toolchain here: reuse the resource monitor the host already runs.
  mkdir -p "$shim/resource-monitor/linux-x64"
  ssh "$HOST" 'sudo -n -u t3 sh -c '\''v=$(sed -n "s/.*\"activeVersion\": *\"\([^\"]*\)\".*/\1/p" ~/.t3/runtime/service-state.json); cat ~/.t3/runtime/versions/$v/resource-monitor/linux-x64/t3-resource-monitor'\''' \
    > "$shim/resource-monitor/linux-x64/t3-resource-monitor"
  chmod 755 "$shim/resource-monitor/linux-x64/t3-resource-monitor"
  # build-cli-archive passes GNU tar's --hard-dereference for Linux; bsdtar lacks it, and macOS
  # pnpm clones files rather than hardlinking them, so dropping it changes nothing.
  cat > "$shim/tar" <<'EOF'
#!/usr/bin/env bash
args=()
for a in "$@"; do [[ "$a" == "--hard-dereference" ]] || args+=("$a"); done
COPYFILE_DISABLE=1 exec /usr/bin/tar --no-mac-metadata --no-xattrs --uid 0 --gid 0 --uname root --gname root "${args[@]}"
EOF
  chmod +x "$shim/tar"
  local tar_path="$PATH"
  [ "$(uname -s)" = Darwin ] && tar_path="$shim:$PATH"
  PATH="$tar_path" node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
    --resource-monitor-dir "$shim/resource-monitor" --output-dir "$out"
  echo "$out/t3-$version-linux-x64.tar.gz"
}

# Copies files into the t3 user's staging directory on the host.
upload() {
  local file name
  ssh "$HOST" 'sudo -n install -d -o t3 -g t3 -m 700 /home/t3/livemap-deploy'
  for file in "$@"; do
    name=$(basename "$file")
    scp -q "$file" "$HOST:/tmp/$name"
    ssh "$HOST" "sudo -n install -o t3 -g t3 -m 600 /tmp/$name /home/t3/livemap-deploy/$name && rm -f /tmp/$name"
  done
}

on_host() {
  upload "$here/deploy-vanessa-host.sh"
  ssh "$HOST" "sudo -n -u t3 bash /home/t3/livemap-deploy/deploy-vanessa-host.sh $*"
}

install_archive() {
  local archive=$1 version
  version=$(basename "$archive")
  version=${version#t3-}
  version=${version%-linux-x64.tar.gz}
  upload "$archive"
  on_host install "'$version'" "'/home/t3/livemap-deploy/$(basename "$archive")'"
}

case "${1:-}" in
  build) build ;;
  install) install_archive "${2:?archive}" ;;
  rollback) on_host rollback "'${2:?version}'" "'${3:?backup dir}'" ;;
  *) sed -n '2,11p' "$0" >&2; exit 2 ;;
esac
