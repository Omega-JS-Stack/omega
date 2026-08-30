# Naked Brand

The monorepo's **bare fixture** — the LEAST a brand monorepo can declare and
still be walked ([#687](https://github.com/Omega-JS-Stack/omega/issues/687)).
Its `config/omega.json5` carries `brand.id`, `brand.name`, one enabled web
target, and a `demo-*` project id; every other section is deliberately absent
so a walkthrough sees the full ask/skip/disable ladder fire **from zero**
rather than from a brand that already answered every question.

The standing brands are too complete for that: `brands/omega-playground` and
`brands/newsflash-brand` are finished consumers, and `brands/sandbox-brand` is
already wired for the automated corpus. This one starts naked on purpose.

**Test infrastructure, never production.** Offline forever: `demo-naked-brand`
is Firebase's emulator-only convention, so every cloud-touching service
short-circuits on it instead of aiming real Google APIs at a project that does
not exist. Nothing here provisions real cloud resources, and no secret ever
lives in the committed config.

## Structure

- `config/omega.json5` — the whole brand-level config, and it is short
- `targets/website/` — the one enabled target (framework: `@omega.js/web`)

There is deliberately **no** `AGENTS.md`/`CLAUDE.md`, no `.env`, no
`.omega/`, no second target, and no page content. Those are things a walk is
supposed to offer to create.

## QA use

```bash
npm install          # from the monorepo root — links @omega.js/* into the brand
npx omega manage     # the full ask/skip/disable ladder, from nothing
```

A walkthrough may leave this brand in any state, and resetting it is
`git clean` + `git checkout` on this folder — nothing outside it depends on
what a run wrote.
