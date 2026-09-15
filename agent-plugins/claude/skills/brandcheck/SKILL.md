---
name: brandcheck
description: Use when editing config/omega.json5, theme or default-page copy, section defaults, or any file that names a brand — brand facts belong in config, never as a hardcoded name, url, or hex, and secrets never in config at all.
user-invocable: true
---

# Brandcheck (config and copy consistency)

One brand fact, one home: `omega.json5`. Everything a page says about the brand comes through `site.*`, and everything it looks like comes through the `--omega-*` tokens the config's one hex feeds. Copy that hardcodes a name, a URL, or a color is a fork that breaks on the next brand.

## Where the truth lives

- `docs/shared/config.md`: the omega.json5 schema, the merge chain, per-target URL resolution, the validator.
- `docs/shared/theming.md` — `brand.color` → `composeBrandTokens()` → the accent ramps, and the token contract components read.
- `docs/web/sections.md` — section defaults and why they carry `{{ site.brand.name }}` rather than a name.

## The checklist

1. **Brand facts are read, never typed.** `{{ site.brand.name }}`, `site.url`, `site.socials.*` — in layouts, sections, section defaults, and default pages alike. A literal brand name or URL in framework or theme copy is the finding; the theme layer speaks generic, and a brand's own voice arrives through section args and config.
2. **The two required fields exist.** `brand.id` (a URL-scheme-safe slug) and `brand.name` are the only universally required config fields — everything else is optional and has a resolution path, so a missing value is a config question, not a place to inline a default in a template.
3. **A brand URL comes from the resolution order**, not from a guess: the target entry's `url`, else that entry's `brand.url`, else the shared `brand.url` for a target named after its type and `https://<name>.<brand host>` for any other name. Brands running several targets (admin, subdomains) are exactly where a typed URL goes wrong.
4. **One hex, and it lives in config.** `brand.color` drives the light and dark accent ramps; markup and scss read `var(--omega-accent…)` and the neutral/status tokens. A second brand hex anywhere in scss or markup means two sources for one color.
5. **Read the RESOLVED config, not one file.** The chain is `defaults ← company ← brand shared ← brand targets.<name> ← local shared ← local targets.<name>`; a value that looks wrong in the local config is often set (or overridden) a layer away.
6. **No secrets in config.** `.env` only; the validator hard-fails secret-shaped keys in omega.json5. An API key arriving as a "brand" value is the same bug wearing a different name.
7. **Copy stays fork-portable.** Defaults, demo args, and sample content show the `{{ site.brand.name }}` tokens a consumer would see, so a fork lands its own name at fork time with nothing to find and replace.

## Verifying

Grep the surface you touched for the brand's literal name, its host, and `#` hex literals — three greps that make this checkable rather than a matter of reading care. Then confirm the value's real home in `config/omega.json5` (app) and the brand root's config.
