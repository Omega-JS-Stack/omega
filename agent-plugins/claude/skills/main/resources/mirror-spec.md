# OMEGA Mirror Spec (SSOT)

The OMEGA frameworks all do more or less the same thing in different ways — so their docs and skills are **mirrored exactly in structure and order**. Same sections, same sequence, framework-specific content inside. This is a hard maintainability rule: an agent who knows one framework's docs can navigate all of them, and structural drift is a bug.

**This file is the single source of truth for the canonical structures.** Every mirrored file carries a short note pointing here.

## What is mirrored

| Surface | Repos | Rule |
|---------|-------|------|
| Root `CLAUDE.md` | UJM, BEM, BXM, EM, MAM (+ WM subset) | Canonical section skeleton below, same order |
| Consumer template `src/defaults/CLAUDE.md` | UJM, BEM, BXM, EM, MAM | Canonical template skeleton below, same order |
| Shared-concept `docs/*.md` | all | Identical FILENAMES for the same concept; mirrored-content docs edited together |
| `omega:*` skills | ujm, bem, bxm, em, wm, mam | Canonical skill skeleton below |

## Canonical root CLAUDE.md skeleton

```
# <Framework Name> (<ABBR>)
## Identity
## Recommended skills
## 🚨 READ WEB-MANAGER TOO        ← omitted where WM doesn't apply (BEM, MAM)
## Quick Start
## Architecture
## CLI
## Dependency Resolution
## Development Workflow
## Supply-Chain Security
## File Conventions
## Doc-update parity
## Documentation
```

**WM (shared library, not a scaffolding framework) uses the subset:** Identity / Recommended skills / Quick Start / Architecture / File Conventions / Doc-update parity / Documentation.

## Canonical consumer template skeleton (`src/defaults/CLAUDE.md`)

```
# ========== Default Values ==========
# <Framework Name> (<ABBR>) — consumer project
## Framework
## 🚨 READ THE FRAMEWORK DOCS FIRST
## 🚨 READ WEB-MANAGER TOO        ← omitted where WM doesn't apply (BEM, MAM)
## Quick start
## Where things live
## Per-context imports            ← omitted where consumers import nothing at runtime (MAM)
## Available APIs at runtime      ← same omission rule
## Dependency resolution
## Testing
# ========== Custom Values ==========
## Project-specific notes
```

## Canonical omega skill skeleton (`skills/<fw>/SKILL.md`)

```
# <Framework> Patterns
## Read these first (SSOT)
## Hard rules
## Processes
```

(`omega:main` is the hub and has its own shape — it is not one of the mirrored framework routers.)

## The three rules

1. **Order is law.** Canonical sections appear in the canonical order, always. Framework-specific EXTRA sections may be INSERTED between canonical ones (e.g. UJM's `## 🚨 BOOTSTRAP-FIRST`, `## Animation Studio` in its consumer template) — but canonical sections are never reordered, renamed, or split.
2. **Omission over vestigial sections.** A canonical section that genuinely doesn't apply is omitted (BEM/MAM have no web-manager; MAM consumers have no runtime imports) — never left in as an empty stub. The omissions are listed here; a new omission means updating this spec.
3. **Edit all siblings together.** Changing a canonical section name/order, adding a shared-concept doc, or restructuring a skill means making the SAME change in every sister repo in the same pass — plus updating this spec. Mirrored-CONTENT docs (currently `docs/cdp-debugging.md` — same core section, framework flavor) say so in a blockquote at the top and are edited together.

## Shared-concept doc filenames

When a concept exists in 2+ frameworks, the doc file gets the SAME name in each (`docs/audit.md`, `docs/build-system.md`, `docs/cdp-debugging.md`, `docs/common-mistakes.md`, `docs/environment-detection.md`, `docs/logging.md`, `docs/migration.md`, `docs/test-framework.md`, `docs/test-boot-layer.md`, `docs/themes.md`, `docs/icons.md`, `docs/templating.md`, `docs/xss-prevention.md`, …). Framework-specific docs are named freely. The `## Documentation` section indexes them: intro sentence + link list (grouping into `###` subsections allowed); shared-concept docs should appear in every index.

## Known gaps (young frameworks)

- **MAM** (v0.0.x): no `docs/` split yet (deep content lives inline in root CLAUDE.md), no `npx mgr` CLI surface yet (npm scripts are the CLI), no `safeInstall()` supply-chain wiring yet. Its CLAUDE.md follows the canonical skeleton with these gaps stated honestly in the relevant sections.
