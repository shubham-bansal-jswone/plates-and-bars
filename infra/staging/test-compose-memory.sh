#!/usr/bin/env bash
# Checks the api service's memory sizing in docker-compose.yml (#990): a container limit with no swap, an explicit -Xmx, and
# a heap that holds the API's cap of 2 concurrent image decodes (4096 x 4096 x 4 B each) plus a working set, with headroom
# below the limit for non-heap memory. Offline; needs docker compose and python3. Run from anywhere:
#   infra/staging/test-compose-memory.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
docker compose --env-file .env.example config --format json | python3 -I -c '
import json, re, sys
api = json.load(sys.stdin)["services"]["api"]
MIB = 1 << 20
limit = int(api.get("mem_limit", 0))
assert limit > 0, "api has no mem_limit"
assert int(api.get("memswap_limit", 0)) == limit, "memswap_limit must equal mem_limit (no swap)"
opts = api["environment"].get("JAVA_TOOL_OPTIONS", "")
m = re.search(r"(?:^| )-Xmx(\d+)([mMgG])(?: |$)", opts)
assert m, "JAVA_TOOL_OPTIONS has no -Xmx"
heap = int(m.group(1)) * (MIB if m.group(2) in "mM" else 1024 * MIB)
decodes = 2 * 4096 * 4096 * 4          # AiImages.MAX_CONCURRENT x the largest photo
copies = 64 * MIB                      # re-encoded copies, base64 text and request bodies in flight
working_set = 256 * MIB                # Spring Boot, JDBC pool, Caffeine, in-flight sync and export pages
assert heap >= decodes + copies + working_set, "heap %d MiB is under 2 decodes + copies + working set (%d MiB)" % (heap // MIB, (decodes + copies + working_set) // MIB)
assert limit - heap >= 320 * MIB, "under 320 MiB of the limit is left for metaspace, code cache, thread stacks and native buffers"
assert limit <= 1536 * MIB, "limit above 1.5 GiB: the stack must stay inside the free-tier VM budget (RUNBOOK.md)"
print("api: limit %d MiB, heap %d MiB" % (limit // MIB, heap // MIB))
'
echo "OK"
