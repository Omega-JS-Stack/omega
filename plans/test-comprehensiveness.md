# Test harmonization + comprehensiveness pass (Ian-queued 2026-07-22)

> Ian: "we need a HUGE test harmonization pass and comprehensiveness pass to ensure as much stuff as
> possible is covered." Sequenced AFTER the review waves (waves 2–6 are code-review waves, not coverage —
> confirmed not already in them). The cp260 token-sync bugs motivated this: both desktop and extension
> auth sync were broken and no test caught it until the `test:auth` lane was built.

## 1. Real-surface auth e2e (the named gap)

- **Extension**: launch real Chrome with the built extension loaded (CDP/omega-extension MCP or
  puppeteer-style harness), sign in as an emulator test user on the test site, assert the SW's
  syncAuth round-trips the custom token and the popup reflects the signed-in state.
- **Desktop**: launch the real Electron app (sandbox/playground consumer), drive the deep-link
  `auth/token` flow against the emulator, assert main + renderer both land signed in
  (extends the existing `test:auth` lane from wire-contract to full-app).
- Both use emulator test users only; offline; join the root battery (flake-budget permitting —
  a separate `test:e2e-surfaces` lane if too slow for every run).

## 2. Harmonization pass

- One test vocabulary across all frameworks: same runner semantics, same target syntax, same
  extended-mode flag (largely done — verify and close gaps), same log-file conventions.
- Same coverage CONTRACT per framework: every feature tested at every surface it exposes
  (logic / wiring / rules / UI), mirrored-implementation rule applied to test shape too.

## 3. Comprehensiveness sweep

- Inventory per package: enumerate features/routes/modules vs existing suites; produce a gap table.
- Close the gaps priority-ordered: auth flows, payment pipeline, cross-context IPC/messaging,
  config resolution, deploy verbs (dry-run), CLI commands.
- Completeness critic at the end: what modality is still untested (visual, SW lifecycle, offline,
  multi-instance)?

Exit: gap table empty or every remaining gap is a deliberate, documented skip.
