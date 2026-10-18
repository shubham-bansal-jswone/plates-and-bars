#!/usr/bin/env bash
# Checks the api service's memory sizing in docker-compose.yml (#990): a container limit with no swap,
# an explicit -Xmx (the last one counts) and -XX:+ExitOnOutOfMemoryError, a heap that holds the API's cap of 2 concurrent image
# decodes (about 200 MiB each) plus a working set, and at least 384 MiB between heap and limit for non-heap memory. Offline; needs docker compose and python3. Run from anywhere:
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
found = re.findall(r"(?:^| )-Xmx(\d+)([mMgG])(?= |$)", opts)
assert found, "JAVA_TOOL_OPTIONS has no -Xmx"
n, unit = found[-1]                    # the JVM uses the last -Xmx
heap = int(n) * (MIB if unit in "mM" else 1024 * MIB)
assert re.search(r"(?:^| )-XX:\+ExitOnOutOfMemoryError(?: |$)", opts), "JAVA_TOOL_OPTIONS lacks -XX:+ExitOnOutOfMemoryError"
decodes = 2 * 200 * MIB                # AiImages.MAX_CONCURRENT x about 200 MiB worst case (16-bit RGBA PNG, raster + resize copy)
copies = 64 * MIB                      # re-encoded copies, base64 text and request bodies in flight
working_set = 256 * MIB                # Spring Boot, JDBC pool, Caffeine, in-flight sync and export pages
slack = 48 * MIB                       # so the floor is 2 x 200 + 64 + 256 + 48 = 768 MiB
assert heap >= decodes + copies + working_set + slack, "heap %d MiB is under 2 decodes + copies + working set + slack (%d MiB)" % (heap // MIB, (decodes + copies + working_set + slack) // MIB)
assert limit - heap >= 384 * MIB, "under 384 MiB of the limit is left for metaspace, code cache, thread stacks and native buffers"
assert limit <= 1536 * MIB, "limit above 1.5 GiB: the stack must stay inside the free-tier VM budget (RUNBOOK.md)"
print("api: limit %d MiB, heap %d MiB" % (limit // MIB, heap // MIB))
'
echo "OK"
