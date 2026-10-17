#!/usr/bin/env bash
# Checks the journald drop-in's settings and install.sh (dry run, install, idempotency, drift repair) with a stub
# systemctl and a temp directory. No root or journald needed. Run from anywhere: infra/journald/test-install.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
mkdir "$tmp/bin"
cat > "$tmp/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
echo "systemctl $*" >> "$STUB_LOG"
STUB
chmod +x "$tmp/bin/systemctl"
export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/log" JOURNALD_DROPIN_DIR="$tmp/dropin"
: > "$STUB_LOG"

conf="$here/plate-and-bar.conf"
for line in '[Journal]' 'Storage=persistent' 'MaxFileSec=1day' 'MaxRetentionSec=13day' 'SystemMaxUse=200M'; do
  grep -qx "$line" "$conf" || fail "drop-in lacks $line"
done
# the age bound: retention plus the one-day file span stays within 14 days
days="$(sed -n 's/^MaxRetentionSec=\([0-9]*\)day$/\1/p' "$conf")"
[ "$((days + 1))" -le 14 ] || fail "MaxRetentionSec $days days plus one file day exceeds 14"

"$here/install.sh" --dry-run > "$tmp/out"
grep -q 'would install' "$tmp/out" || fail "dry run says nothing"
[ ! -e "$tmp/dropin" ] || fail "dry run wrote files"
[ ! -s "$STUB_LOG" ] || fail "dry run called systemctl"

"$here/install.sh" > /dev/null
cmp -s "$conf" "$tmp/dropin/plate-and-bar.conf" || fail "installed file differs"
[ "$(grep -c 'systemctl restart systemd-journald' "$STUB_LOG")" = 1 ] || fail "journald not restarted once"

"$here/install.sh" > "$tmp/out"
grep -q 'already installed' "$tmp/out" || fail "second run not a no-op"
[ "$(grep -c 'systemctl' "$STUB_LOG")" = 1 ] || fail "second run restarted journald"

echo "Storage=volatile" > "$tmp/dropin/plate-and-bar.conf"   # drift is repaired
"$here/install.sh" > /dev/null
cmp -s "$conf" "$tmp/dropin/plate-and-bar.conf" || fail "drift not repaired"
[ "$(grep -c 'systemctl' "$STUB_LOG")" = 2 ] || fail "repair did not restart journald"

if "$here/install.sh" --bogus > /dev/null 2>&1; then fail "accepted an unknown option"; fi
unset JOURNALD_DROPIN_DIR
if [ "$(id -u)" -ne 0 ] && "$here/install.sh" > /dev/null 2>&1; then fail "non-root install to /etc succeeded"; fi
echo "journald install tests passed"
