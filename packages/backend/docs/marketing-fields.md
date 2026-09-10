# Marketing Custom Fields

@omega.js/backend syncs user data to marketing providers (SendGrid, Beehiiv) as custom fields. Field definitions live in a single dictionary; OMEGA provisions them in each provider.

## Adding a New Field

1. Add the field to `FIELDS` in `src/manager/libraries/email/constants.js` — the key IS the field name in both providers. Set `source`, `path`, `type`. A provider that must NOT carry it goes in `skip: ['beehiiv']`.
2. Nothing to add anywhere else: `fieldsForProvider(provider)` beside the dictionary is the ONE derivation of a provider's view, read by OMEGA's `custom-fields` ensure (what gets provisioned) and by the provider's `buildFields()` (what gets written), so the two lists cannot drift ([#695](https://github.com/Omega-JS-Stack/omega/issues/695)).
3. Run OMEGA: `npx omega manage --service=campaigns,newsletter` from the brand root.
4. @omega.js/backend resolves field IDs at runtime — no provider code changes needed.

## How It Works

- **SendGrid**: `resolveFieldIds()` fetches field definitions from the SendGrid API, builds a name-to-ID cache, and maps values to SendGrid's auto-generated IDs (e.g., `brand_id` maps to `e35_T`). First/last name are `skip: ['sendgrid']` — SendGrid keeps them in its own reserved contact columns, which `addContact()` writes natively, so they are never a custom field here.
- **Beehiiv**: @omega.js/backend uses the key directly as the custom field name — no ID resolution needed.
- **OMEGA**: The `ensure/custom-fields.js` handlers are idempotent — they fetch existing fields and only create what is missing.

## Key Files

| Purpose | File |
|---------|------|
| Field dictionary + per-provider view (the ONE SSOT) | `src/manager/libraries/email/constants.js` (`FIELDS`, `fieldsForProvider()`) |
| How OMEGA reads the dictionary | `@omega.js/manager` `src/lib/backend-marketing.js` |
| SendGrid provisioning | `@omega.js/manager` `src/services/campaigns/ensure/custom-fields.js` |
| Beehiiv provisioning | `@omega.js/manager` `src/services/newsletter/ensure/custom-fields.js` |
