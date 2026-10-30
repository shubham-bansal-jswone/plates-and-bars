# docs/

Where to find things. The spec (`spec/PROTOTYPE_SPEC.md` plus `spec/golden/`) is the behaviour specification; everything else explains or indexes it. The HTML prototype was removed; see git tag `prototype-final`.

    AGENTS.md                      rules and lanes for every agent (read first)
    development-plan.md            scope, stack, data model, milestones, budget
    adr/                           architecture decision records
    spec/PROTOTYPE_SPEC.md         behaviour spec; section 0 lists what changed and when
    spec/golden/*.json             fixtures of record; change only in a `spec-change` PR
    spec/ISSUES.md                 work items from the 2026-10-07 handoff, with acceptance criteria
    INCIDENT-RESPONSE.md           personal data breach runbook (DPDP notification, templates)
    ACCOUNT-DELETION-RUNBOOK.md    deleting an account on an emailed request (code check, DELETE /me, replies)
    PLAY-DATA-SAFETY.md            Play Console Data safety and Health apps declaration answers
    PLAY-STORE-LISTING.md          Play store listing drafts, store settings, audience and content rating answers
    check-play-listing.mjs         checks the listing's lengths, disclaimer and placeholders (node docs/check-play-listing.mjs)

To change behaviour, follow "When the spec changes" in AGENTS.md.

## Licence

Code is licensed under the [Apache License 2.0](../LICENSE). Our own written content (the cards, recipe text and exercise notes in `content/`, and app and website copy) is licensed under [CC BY 4.0](../CONTENT-LICENSE). Third-party data and assets keep their own licences: see [NOTICE](../NOTICE) and [THIRD_PARTY.md](../THIRD_PARTY.md).
