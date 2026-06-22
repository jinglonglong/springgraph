#!/bin/sh
#
# Springgraph standalone installer.
#
# Downloads a self-contained bundle (a vendored Node runtime + the app) from
# GitHub Releases. No Node.js, no build tools, no npm required — ideal for a
# fresh Linux VPS over SSH.
#
#   curl -fsSL https://raw.githubusercontent.com/colbymchenry/springgraph/main/install.sh | sh
#
# Upgrade:   run `springgraph upgrade` (or just re-run the same command).
# Uninstall: curl -fsSL .../install.sh | sh -s -- --uninstall
#
# Environment:
#   SPRINGGRAPH_VERSION      release tag to install (default: latest)
#   SPRINGGRAPH_INSTALL_DIR  bundle location   (default: ~/.springgraph)
#   SPRINGGRAPH_BIN_DIR      symlink location  (default: ~/.local/bin)
set -eu

REPO="colbymchenry/springgraph"
INSTALL_DIR="${SPRINGGRAPH_INSTALL_DIR:-$HOME/.springgraph}"
BIN_DIR="${SPRINGGRAPH_BIN_DIR:-$HOME/.local/bin}"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN_DIR/springgraph"
  rm -rf "$INSTALL_DIR"
  echo "Springgraph uninstalled (removed $INSTALL_DIR and $BIN_DIR/springgraph)."
  exit 0
fi

# 1. Detect platform → target triple matching the release archives.
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "springgraph: unsupported OS '$os'." >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *) echo "springgraph: unsupported architecture '$arch'." >&2; exit 1 ;;
esac
target="${os}-${arch}"

# 2. Resolve the version (latest release unless pinned).
#
# Resolve "latest" from the releases/latest *web* redirect, not the GitHub API:
# the unauthenticated API is rate-limited to 60 requests/hour per IP and returns
# 403 once exhausted — routine on shared/cloud hosts and CI (issue #325). The
# redirect (github.com/<repo>/releases/latest -> .../releases/tag/vX.Y.Z) has no
# such limit. Fall back to the API if the redirect can't be read.
version="${SPRINGGRAPH_VERSION:-}"
if [ -z "$version" ]; then
  version="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" \
    | sed -n 's#.*/releases/tag/##p')"
fi
if [ -z "$version" ]; then
  version="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -n "$version" ] || { echo "springgraph: could not resolve latest version; set SPRINGGRAPH_VERSION (e.g. SPRINGGRAPH_VERSION=v0.9.4)." >&2; exit 1; }
# Release tags are vX.Y.Z; accept a bare X.Y.Z in SPRINGGRAPH_VERSION too.
case "$version" in v*) ;; *) version="v$version" ;; esac

# 3. Download + extract the bundle.
url="https://github.com/$REPO/releases/download/$version/springgraph-${target}.tar.gz"
echo "Installing Springgraph $version ($target)..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/cg.tar.gz" || { echo "springgraph: download failed: $url" >&2; exit 1; }

dest="$INSTALL_DIR/versions/$version"
rm -rf "$dest"
mkdir -p "$dest"
# Archives contain a top-level springgraph-<target>/ dir; strip it.
tar -xzf "$tmp/cg.tar.gz" -C "$dest" --strip-components=1

# 4. Symlink the launcher onto PATH and mark the current version.
mkdir -p "$BIN_DIR"
ln -sf "$dest/bin/springgraph" "$BIN_DIR/springgraph"
ln -sfn "$dest" "$INSTALL_DIR/current"

echo "Installed to $dest"
echo "Linked     $BIN_DIR/springgraph"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "$BIN_DIR is not on your PATH. Add it:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
echo ""
echo "Done. Run: springgraph --help"
