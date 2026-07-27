# Finding a Project Repo by Brand Name

When the user references a project by brand name (e.g. "audit proxifly payment flow", "fix somiibo signup", "check the studymonkey extension"), resolve the brand name to an actual repo path BEFORE attempting any file operations, Bash commands, or Glob searches against guessed paths.

## Why this matters

OMEGA repos live under `/Users/ian/Developer/Repositories/ITW-Creative-Works/`, but the directory name varies by framework and brand:
- UJM sites may be `{brand}` OR `{brand}-website`
- BEM backends may be `{brand}-backend`
- BXM extensions may be `{brand}-extension`
- MAM mobile apps may be `{brand}-mobile`
- EM desktop apps may be `{brand}-desktop`
- Some brands have multiple subdomain websites: `{brand}-website-{subdomain}`

A single wrong guess followed by "directory not found" is NOT evidence the repo doesn't exist — it just means the naming convention was wrong.

## Resolution process (in order)

### 1. Infer the framework type from the user's request

| User phrase | Likely framework | `--path` alias |
|-------------|------------------|----------------|
| "audit {brand}" (no qualifier) | UJM (website is the default face of a brand) | `website` |
| "{brand} backend", "{brand} BEM", "{brand} API", "{brand} functions" | BEM | `backend` |
| "{brand} website", "{brand} site", "{brand} UJM" | UJM | `website` |
| "{brand} extension", "{brand} BXM", "{brand} chrome" | BXM | `browser-extension` |
| "{brand} mobile", "{brand} app", "{brand} MAM", "{brand} iOS/Android" | MAM | `mobile` |
| "{brand} desktop", "{brand} EM", "{brand} electron" | EM | `desktop` |

If the user's request mentions a specific framework context (e.g. "payment flow" strongly implies BEM), use that framework. If unsure, ask the user.

### 2. Ask omega-manager for the canonical path

Run this from the omega-manager repo:

```bash
cd /Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager && npm run brands -- --path={alias}
```

Where `{alias}` is one of: `website`, `backend`, `browser-extension`, `mobile`, `desktop`.

This outputs every repo path for that framework type, one per line. Grep the output for the brand name to find the canonical path.

Example:
```bash
cd /Users/ian/Developer/Repositories/ITW-Creative-Works/omega-manager && npm run brands -- --path=backend 2>/dev/null | grep -i proxifly
```

Framework aliases the script also accepts: `uj`/`ujm` → `website`, `bm`/`bem` → `backend`, `em` → `desktop`, `mam` → `mobile`, `bxm` → `browser-extension`.

### 3. Fallback: Glob the parent directory

If `omega-manager` is unavailable or the brand isn't registered there, use Glob as a fallback:

```
Glob: /Users/ian/Developer/Repositories/ITW-Creative-Works/*proxifly*
```

This surfaces every directory containing the brand name, including `proxifly`, `proxifly-backend`, `proxifly-website-docs`, etc.

### 4. Last resort: Ask the user

If steps 1–3 fail to locate the repo, **ask the user for the path** rather than silently proceeding with a guess or reporting "couldn't find it" as a dead end.

## Anti-patterns

- ❌ Running `ls /Users/ian/Developer/Repositories/ITW-Creative-Works/proxifly/functions` once, getting an error, and concluding the project doesn't exist
- ❌ Hardcoding `{brand}-backend` as the BEM path convention — some brands use `{brand}` alone
- ❌ Assuming the current working directory is the target project
- ❌ Calling `Bash ls` to explore — use `Glob` for discovery instead

## Correct pattern

1. User says "audit proxifly payment flow"
2. Infer framework: "payment flow" → BEM → alias `backend`
3. Run `npm run brands -- --path=backend` from omega-manager, grep for `proxifly`
4. Use the resolved path for all subsequent Read/Grep/Bash operations
5. If not found, fall back to Glob, then ask the user
