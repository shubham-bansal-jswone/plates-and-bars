#!/bin/sh
# Hard 14-day cap on container logs written by Docker's `local` log driver. backup.sh feeds this file to a busybox
# container (`sh -s /containers < logcap.sh`) with /var/lib/docker/containers mounted; tests run it on a fake tree:
#   logcap.sh <containers dir>
# Docker rotates by size only (10m x 5 files, docker-compose.yml). Per container, nightly:
#  - rotated files (container.log.1, .2.gz ...) whose last write is 13 or more days old are deleted: every line in
#    them is at least that old, and the next run is a day later, so nothing reaches 14 days;
#  - the active container.log cannot be read by age (binary), so it is emptied when it is 13 or more days since the
#    last emptying (stamp file logcap.stamp next to it), or when there is no stamp yet. On a busy host it rotates
#    long before that and this never matters; on a quiet one it holds only lines written since the last emptying.
# Emptying in place is safe because Docker opens the file with O_APPEND (not verified on the VM, RUNBOOK.md section 3).
# It also drops recent lines on that night: preserve logs before the cron runs in an incident (INCIDENT-RESPONSE.md).
# Uses only POSIX sh and busybox/GNU/BSD find with -mtime.
set -eu
root="${1:?usage: logcap.sh <containers dir>}"
for dir in "$root"/*/local-logs; do
  [ -d "$dir" ] || continue
  find "$dir" -type f -name 'container.log.*' -mtime +12 -exec rm -f {} +
  active="$dir/container.log"
  stamp="$dir/../logcap.stamp"
  [ -f "$active" ] || continue
  if [ ! -f "$stamp" ] || [ -n "$(find "$stamp" -mtime +12)" ]; then
    : > "$active"
    : > "$stamp"
    echo "log cap: emptied $active"
  fi
done
