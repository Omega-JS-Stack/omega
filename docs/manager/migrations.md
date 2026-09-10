# The migrations service — Firestore and on-disk migrations

The `migrations` service runs migrations against the brand's Firestore collections and, for
`local: true` operations, against the brand's own files. It only runs when `--migration` is
set, so a normal manage walk never touches collection data — and even then a run is an AUDIT:
it prints what every fix WOULD do and writes nothing until `--execute`.

```
npx omega manage --migration                       # every migration, audit only
npx omega manage --migration=users                 # one migration, audit only
npx omega manage --migration=users --execute       # perform it
```

An unknown `--migration=<name>` lists the available ones and skips.

## The registered migrations

| Migration | What it converges |
|---|---|
| `targets-rename` (local) | A pre-[#443](https://github.com/Omega-JS-Stack/omega/issues/443) brand's `apps/` folder → `targets/`, moving the folder and flipping the root `workspaces` glob together. |
| `notifications` | Push-subscription docs to the canonical shape: `uid` → `owner`, flattened `owner.uid`, legacy timestamps → `metadata.*`, `url` → `context.client.url`, the legacy `attribution.utm` blob folded into `first`/`last`, string trimming — then schema validation. |
| `users` | The canonical user schema: orphan docs deleted, `plan` → `subscription`, flat `subscription.id` → `subscription.product`, `oauth2.<provider>` → `connections.<provider>` with a `type: 'oauth2'` stamp and the original deleted ([#788](https://github.com/Omega-JS-Stack/omega/issues/788)), each moved record gaining the `identity.id` the connections route matches on — from Google's `sub` or Kick's `user_id`, as a string, deleting nothing ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)), deprecated fields removed, timestamps reconciled against Firebase Auth's canonical creation time, auth/consent/attribution backfills, dynamic values generated, sentinels (`''`, `127.0.0.1`, `ZZ`, `Unknown`) normalized to null, `usage.*.period` → `usage.*.monthly`. |
| `orders` | `payments-orders`: the legacy `attribution.utm` blob → first/last touches. |
| `payments-intents` | The same fold on `payments-intents`, the upstream copy of the same degradation. |
| `payment-provider` | The [#428](https://github.com/Omega-JS-Stack/omega/issues/428) word rename's DATA half: the stored `processor` field → `provider`, across all five payment-touching collections (`users.subscription.payment.processor`, `payments-orders.processor`, `payments-intents.processor`, `payments-webhooks.processor`, `payments-disputes.alert.processor`). |
| `state-retirement` (local) | The retired `.omega/state.json` CONTENT into `config/omega.json5` + the brand `.env` ([#434](https://github.com/Omega-JS-Stack/omega/issues/434)), leaving the file's machine records alone ([#479](https://github.com/Omega-JS-Stack/omega/issues/479)). |

Register a new one by adding a handler in `src/services/migrations/ensure/` and an entry in
`config.js`'s `OPERATIONS.migrations`.

## Config and credentials

No config of its own. The Firestore migrations need a `backend` target and the brand's own
service account at `.omega/secrets/service-account.json` (Identity Toolkit + `FirestoreREST`,
not `firebase-admin`). The two `local: true` migrations need NEITHER — they only touch the
brand's own files.

## Gotchas

- **`targets-rename` is the one migration a walk can never reach** on the brand it fixes:
  discovery FAILS LOUD on the old shape, so `runManage` runs it ALONE, ahead of the load that
  would throw. A brand carrying BOTH folders is FATAL, not merged — which copy is real is a
  guess. Run `npm install` afterwards so npm re-links `node_modules/<target>` at the new path.
- **Migrations without schema validation are deliberate.** The payment collections' shapes are
  owned by the webhook pipeline, so `orders`, `payments-intents` and `payment-provider` touch
  their one field and declare nothing else.
- **`payment-provider` is idempotent by construction**: no legacy key is a strict no-op, both
  keys present keeps `provider` (written by current code, so newer) and drops the leftover, and
  a `null` value still moves — `null` is what the schema stores for an account that never paid.
- **The `users` connections move follows the same rule** ([#788](https://github.com/Omega-JS-Stack/omega/issues/788)):
  no `oauth2` is a strict no-op, both keys present keeps `connections` and deletes only the
  leftover, and the original is deleted in the same write — the standing ruling on a migration
  that MOVES a field. It runs ahead of the defaults backfill, or the backfill would write an
  empty `connections` object the move then collides with.
- **Legacy one-offs stay in omega-manager.** Its other 25 registered migrations repair one
  company's historical data, not the schema.
