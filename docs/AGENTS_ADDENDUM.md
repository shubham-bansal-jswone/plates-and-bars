# Add to docs/AGENTS.md

## Behaviour source of truth

- The prototype in `docs/prototype/plate-and-bar.html` defines how the app behaves. Read the relevant part of it before writing code; function names are listed in `docs/spec/PROTOTYPE_SPEC.md`.
- Port logic into `packages/core`; don't redesign it. If something looks wrong, open an issue labelled `spec-question` instead of "fixing" it silently.
- Every ported rule needs a test that loads the matching file in `docs/spec/golden/` and reproduces it exactly (numbers rounded the same way).
- Food data: only USDA, FSSAI-derived values, our own recipes and kitchen tests. Never add IFCT or INDB data.
- Carbs everywhere are total carbohydrate including fibre.

## When the prototype changes

1. A new `docs/prototype/plate-and-bar.html` and regenerated `docs/spec/golden/` land in one PR labelled `spec-change`, with a dated entry at the top of section 0 of the spec.
2. CI fails any golden test that no longer matches; the owning agent updates the port in a follow-up PR that references the `spec-change` PR.
3. Never edit golden files by hand.
