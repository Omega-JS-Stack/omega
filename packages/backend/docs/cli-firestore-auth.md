# CLI: Firestore & Auth Commands

Quick commands for reading/writing Firestore and managing Auth users directly from the terminal. Works in any @omega.js/backend consumer project (production needs the service-account chain; the emulator needs nothing).

**Which stack a subcommand hits** ([#51](https://github.com/Omega-JS-Stack/omega/issues/51)): the ones that MUTATE state — `firestore:set`, `firestore:delete`, `auth:set-claims`, `auth:delete`, `auth:token` — target the **emulator by default**, and reach live only with an explicit `--production`. The read-only ones (`firestore:get`, `firestore:query`, `auth:get`, `auth:list`) keep the opposite default: live, with `--emulator` to look at the local stack. Every command prints the stack it hit — the `Target: <projectId> (<stack>)` header, and again in the success line (`Document written to emulator: …`). The rule lives in one place: `src/cli/utils/target.js`.

**IMPORTANT: All CLI commands (`npx omega ...`) MUST be run from the consumer project's `functions/` subdirectory** (e.g., `cd /path/to/my-project/functions && npx omega ...`). The `mgr` binary lives in `functions/node_modules/.bin/` — running from the project root or any other directory will fail.

For log commands, see [docs/cli-logs.md](cli-logs.md).

## Firestore Commands

```bash
npx omega firestore:get <path>                          # Read a document
npx omega firestore:set <path> '<json>'                 # Write/merge a document (emulator; --production for live)
npx omega firestore:set <path> '<json>' --no-merge      # Overwrite a document entirely
npx omega firestore:query <collection>                  # Query a collection (default limit 25)
  --where "field==value"                              #   Filter (repeatable for AND)
  --orderBy "field:desc"                              #   Sort
  --limit N                                           #   Limit results
npx omega firestore:delete <path>                       # Delete a document (emulator; --production prompts for confirmation)
```

## Auth Commands

```bash
npx omega auth:get <uid-or-email>                       # Get user by UID or email (auto-detected via @)
npx omega auth:list [--limit N] [--page-token T]        # List users (default 100)
npx omega auth:delete <uid-or-email>                    # Delete user (emulator; --production prompts for confirmation)
npx omega auth:set-claims <uid-or-email> '<json>'       # Set custom claims (emulator; --production for live)
npx omega auth:token <uid-or-email>                     # Mint a custom token + one-click sign-in URL (QA)
```

### `auth:token` — log in as anyone (QA)

Mints a custom token for the user and prints a URL the auth pages consume
directly (`/signin?authCustomToken=…&authReturnUrl=…`) — open it and the
browser IS that user. Like the other state-mutating subcommands it targets the
**emulator by default**; pass `--production` deliberately.

| Flag | Description |
|------|-------------|
| `--url <base>` | Website base URL for the printed link (default `http://localhost:4000`) |
| `--return <path>` | `authReturnUrl` after sign-in (default `/dashboard`) |
| `--production` | Mint against production instead of the emulator |

## Shared Flags

| Flag | Description |
|------|-------------|
| `--production` | Target the live stack instead of the emulator (state-mutating subcommands) |
| `--emulator` | Target the local emulator instead of live (read-only subcommands) |
| `--force` | Skip confirmation on destructive operations |
| `--raw` | Compact JSON output (for piping to `jq` etc.) |

## Examples

```bash
# Read a user document from production
npx omega firestore:get users/abc123

# Write to the emulator (the default)
npx omega firestore:set users/test123 '{"name":"Test User"}'

# Write to production (deliberate)
npx omega firestore:set users/abc123 '{"name":"Real User"}' --production

# Query with filters
npx omega firestore:query users --where "subscription.status==active" --limit 10

# Look up auth user by email
npx omega auth:get user@example.com

# Set admin claims
npx omega auth:set-claims user@example.com '{"admin":true}'

# One-click sign-in URL for a seeded persona (emulator)
npx omega auth:token _test.admin@playground.omegajs.dev --return /account

# Delete from the emulator (the default — no confirmation needed)
npx omega firestore:delete users/test123
```
