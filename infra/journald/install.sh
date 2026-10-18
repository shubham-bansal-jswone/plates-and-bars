#!/usr/bin/env bash
# Installs plate-and-bar.conf as a journald drop-in and restarts journald only when the file changed (idempotent).
#   sudo infra/journald/install.sh [--dry-run]
# --dry-run prints what would change and writes nothing. JOURNALD_DROPIN_DIR (default /etc/systemd/journald.conf.d)
# exists so the tests can use a temp dir; root is only required for the default.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/plate-and-bar.conf"
dir="${JOURNALD_DROPIN_DIR:-/etc/systemd/journald.conf.d}"
dest="$dir/plate-and-bar.conf"
dry=0
case "${1:-}" in
  "") ;;
  --dry-run) dry=1 ;;
  *) echo "usage: install.sh [--dry-run]" >&2; exit 2 ;;
esac
if [ "$dry" = 0 ] && [ -z "${JOURNALD_DROPIN_DIR:-}" ] && [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo $0" >&2; exit 1
fi
if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
  echo "journald drop-in already installed: $dest"; exit 0
fi
if [ "$dry" = 1 ]; then
  echo "would install $src to $dest and restart systemd-journald"
  if [ -f "$dest" ]; then diff -u "$dest" "$src" || true; else echo "(new file)"; fi
  exit 0
fi
install -d -m 0755 "$dir"
install -m 0644 "$src" "$dest"
systemctl restart systemd-journald
echo "installed $dest and restarted systemd-journald"
# Show what journald now runs with (the drop-in must appear last); informational, so a missing tool is not an error.
systemd-analyze cat-config systemd/journald.conf || echo "warning: could not print the effective journald config" >&2
