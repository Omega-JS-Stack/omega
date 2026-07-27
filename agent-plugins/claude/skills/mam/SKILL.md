---
name: mam
description: MAM React Native mobile app architecture, build pipeline, and dependency-sync patterns for the mobile-app-manager framework and its consumer projects. - Use when creating, editing, or working with mobile apps built on Mobile App Manager (MAM). Triggers on "MAM", "mobile-app-manager", "Mobile App Manager", "mobile app", "React Native", "react-native", "iOS app", "Android app", "Metro bundler", "CocoaPods", "pod install", "npm run ios", "npm run android", "config/mobile-app-manager.json", or any work on files in src/App.tsx, src/components/, src/utils/ inside a MAM consumer project.
user-invocable: true
---

# MAM Mobile App Patterns

## Read these first (SSOT)

1. **`node_modules/mobile-app-manager/CLAUDE.md`** (in a consumer) or the framework repo's `CLAUDE.md` — architecture, build pipeline (`src/` → gulp → `dist/` React Native project), dependency sync, troubleshooting. MAM is the youngest OMEGA framework (v0.0.x): deep content lives inline there (no `docs/` split yet).
2. The consumer's own `CLAUDE.md` — scaffolded from MAM's `src/defaults/CLAUDE.md`, with project-specific notes under Custom Values.

## Hard rules

1. 🚫 **NEVER edit `dist/`** — it is the ENTIRE managed React Native project; edit `src/` and `config/`, gulp regenerates (repo CLAUDE.md § Architecture).
2. **Install dependencies at the consumer ROOT, never in `dist/`** — MAM syncs and installs automatically (repo CLAUDE.md § Dependency Resolution).
3. **The CLI is npm scripts** (`setup` / `gulp` / `ios` / `android` / `clean`) — MAM does not yet expose the `npx mgr` surface the sister frameworks share (repo CLAUDE.md § CLI).
4. 🚫 **Never run `react-native init` or clean `dist/` by hand** — MAM owns both (repo CLAUDE.md § File Conventions).
5. **TypeScript-first in `src/`** — `.tsx` components, `.ts` utilities, tests in `src/__tests__/` (repo CLAUDE.md § File Conventions).
6. **Supply-chain gap:** MAM has no `safeInstall()`/sfw wiring yet — nothing screens a package before it installs, so install dependencies deliberately and check what you are adding.
7. **Doc parity on every behavioral change** — README + CLAUDE.md + CHANGELOG, after validation.
8. **The OMEGA docs and skills are structurally MIRRORED** — this skill, the repo's CLAUDE.md, the consumer template (`src/defaults/CLAUDE.md`), and shared-concept doc filenames match the sister frameworks section-for-section, in the same order. Structural changes happen in ALL of them in the same pass ([omega:main mirror-spec](../main/resources/mirror-spec.md)).

## Processes

MAM consumer repos typically end in `-mobile`. *Gap: MAM has no audit process/check catalog yet — when one lands, mirror the sister frameworks' `docs/audit.md` shape.*
