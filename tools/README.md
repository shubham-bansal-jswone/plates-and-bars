# tools

Dependency-free content tooling (Node 20+). Run from this folder: `npm ci && npm run lint && npm test && node validate/cli.mjs`.

- `exercises-import/` regenerates `content/exercises.json` from `docs/spec/golden/exercises.json` (`npm run import:exercises`).
- `validate/` checks `content/exercises.json` (`npm run validate:exercises`).

## Exercise card keys

The prototype's `CARDS` use one-letter keys. `content/exercises.json` uses these names, taken from how
`openHowTo`, `learnHtml` and `feelHtml` in `docs/prototype/plate-and-bar.html` render each field.
Values are unchanged. Tag keys are mapped separately (`TAG_KEYS` in `exercises-import/import.mjs`).

| Prototype | Content name | Type | Required | How the prototype uses it |
| --- | --- | --- | --- | --- |
| `f` | `where_to_feel` | string | yes | "Where you should feel it"; text before the first comma is the "felt it in the right place" button |
| `s` | `setup` | string[] | yes | "Setup" numbered steps |
| `c` | `key_cues` | string[] | yes | "3 key cues"; one cue is shown as "Focus this set" in learn mode |
| `m` | `common_mistakes` | string[] | yes | "Common mistakes" list |
| `w` | `misplaced_feel` | [label, fix][] | yes | Each pair is a "felt it in the wrong place" button: `label` is the button text, `fix` is shown as "Try this" |
| `b` | `breathing` | string | no | "Breathing"; the prototype falls back to a default sentence when absent |
| `e` | `easier_version` | string | no | "Easier version" hint |
| `h` | `harder_version` | string | no | "Harder version" hint |

The validator requires the five fields the prototype reads without a guard (`f s c m w`), type-checks the
optional ones, and rejects any other card key.

`misplaced_feel` must be non-empty. That is a content rule rather than a rendering requirement: every card
should offer at least one "felt it in the wrong place" fix.
