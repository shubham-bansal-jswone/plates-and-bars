# Test fixtures

## prototype-oracle.js

Frozen copy of the script body of the prototype, so the differential tests (`test/prototype-*.ts`, via
`prototypeSource()` in `test/helpers.ts`) no longer need `docs/prototype/plate-and-bar.html`. Do not edit by hand.

- Source: `docs/prototype/plate-and-bar.html`, git tag `prototype-final` (commit f94c8e9664fe12f5ff1616773c02b7ce833c8f3a)
- Source sha256: `04e3585a6d96e6451d6c2596c45be483d4863aa5ee1864079febe3ac2f10d1f6`
- Oracle sha256 (`prototype-oracle.js`): `5aefca6be112593dc6e5ee72d87cf7a638f3f2c0396a1e46f64b5e2ff9adcdba`
- The `<script>` tag is on line 407 and `</script>` on line 4565, so the body is lines 408-4564.
- One-time command, run from the repo root at `prototype-final`:

```sh
sed -n '408,4564p' docs/prototype/plate-and-bar.html > packages/core/test/fixtures/prototype-oracle.js
```

Nothing outside the script (HTML or CSS) is used by the tests, so nothing else is included.
