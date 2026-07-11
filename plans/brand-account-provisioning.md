# Brand-account provisioning ownership (queued — Ian interjection 2026-07-10)

> Status: **QUEUED** (PROGRESS Next #4). Ian: the accounts OMEGA auto-creates per brand must stop being hardcoded ITW/Ian values — owners define them; support env-var passwords and possibly company-wide hooks so Ian can keep using his password formula. Nothing built yet; this doc pins the findings + design sketch for when the item is picked up (likely with the dogfood/onboarding-polish arc).

## What exists today (legacy omega-manager, read-only reference)

- `src/services/account/ensure/users.js` — for each entry in `config.js` → `ADMIN_EMAILS`, ensures a Firebase Auth account exists (create + `POST /user/signup` on first run, password-update otherwise), sets `roles.admin: true` + highest-tier subscription on the Firestore user doc, syncs the marketing contact (PUT /marketing/contact), and **audits** that no OTHER account has `roles.admin` (throws on unauthorized admins).
- **The 4 accounts** (`ADMIN_EMAILS`, config.js:77 — all `account: true, marketing: true`):
  1. `ian.wiedenman@gmail.com`
  2. `itw.creative.works@gmail.com`
  3. `hello@itwcreativeworks.com`
  4. `support@{domain}` (templated per brand)
- **Passwords**: `src/services/account/lib/generate-password.js` — Ian's personal keyboard-column formula, **hardcoded in source** (including literal `Ian…Jamal…69$` parts). Deterministic per (email, domain) so re-runs converge.

## What Ian wants (his words, decoded)

1. The auto-created accounts must be **removed from omega** (the framework/manager) and **defined by the owner** — e.g. an onboarding step that asks which admin/support accounts to create.
2. **Env variables** as one way to supply passwords (e.g. per-account password vars in the brand/company `.env`).
3. Maybe **company-wide hooks** — so a formula like his can generate a unique password per brand without ever living in the repo. ("do we have company wide hooks?" — **no**: the monorepo has no hooks system today; this would introduce one.)

## Design sketch (to validate when picked up)

- **Config**: `omega.json5` gains an `accounts` section (owner-defined list: email template + role flags like `admin`/`marketing`, `support@{domain}`-style interpolation kept). NO passwords in config (secrets rule).
- **Passwords, resolution order**: explicit env var (e.g. `OMEGA_ACCOUNT_PASSWORD__SUPPORT` in the company/brand `.env` cascade from D15) → company hook → generated crypto-random (printed once / stored in `.omega/secrets`).
- **Company hooks (new, small)**: `.omega/hooks/<name>.js` at the company root, e.g. `account-password.js` exporting `({ email, domain, brand }) => password`. Ian's formula moves into HIS company's private hook file — out of the framework forever. Hook loading = one `require` + shape check; scope it to named hook points (start with just this one).
- **Onboarding**: a step that shows the resolved account list (from company defaults) and lets the owner edit/confirm; writes the `accounts` section.
- **Port target**: the account ensure/audit logic itself ports into the monorepo manager's service set when brand management arrives there (the admin-audit throw is worth keeping).

## Open questions for Ian (when picked up)

- Should `support@{domain}` stay a default suggestion for every company, or is even that ITW-specific?
- Are the two personal-gmail accounts company-level (every ITW brand) or should the onboarding just read them from ITW's company config?
- Hook points beyond passwords worth doing at the same time (e.g. post-onboarding, post-deploy)? Or keep it to exactly one until a second need appears (YAGNI)?
