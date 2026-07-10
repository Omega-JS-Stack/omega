# CLI: Logs Commands

Fetch or stream Cloud Function logs from Google Cloud Logging. Requires `gcloud` CLI installed and authenticated. Auto-resolves the project ID from `service-account.json`, `.firebaserc`, or `GCLOUD_PROJECT`.

> All `npx omega ...` commands must be run from the consumer project's `functions/` subdirectory. See [docs/cli-firestore-auth.md](cli-firestore-auth.md) for the explanation.

## Commands

```bash
npx omega logs:read                                     # Read last 1h of logs (default: 300 entries, newest first)
npx omega logs:read --fn omega_api                         # Filter by function name
npx omega logs:read --fn omega_api --severity ERROR        # Filter by severity (DEBUG, INFO, WARNING, ERROR, CRITICAL)
npx omega logs:read --since 2d --limit 100              # Custom time range and limit
npx omega logs:read --search "72.134.242.25"            # Search textPayload for a string (IP, email, error, etc.)
npx omega logs:read --fn omega_authBeforeCreate --search "ian@example.com" --since 7d  # Combined filters
npx omega logs:read --order asc                         # Oldest first (default: desc/newest first)
npx omega logs:read --filter 'jsonPayload.level="error"'  # Raw gcloud filter passthrough
npx omega logs:tail                                     # Stream live logs
npx omega logs:tail --fn omega_paymentsWebhookOnWrite      # Stream filtered live logs
```

Both commands save output to `functions/production.log` (overwritten on each run). `logs:read` saves raw JSON; `logs:tail` streams text.

**Cloud Logs vs Local Logs:** These commands query **production** Google Cloud Logging. For **local/dev** logs, read `functions/dev.log` (from `npx omega serve`) or `functions/emulator.log` (from `npx omega test`) directly — they are plain text files, not gcloud.

## Flags

| Flag | Description | Default | Commands |
|------|-------------|---------|----------|
| `--fn <name>` | Filter by Cloud Function name (see table below) | all | both |
| `--severity <level>` | Minimum severity: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` | all | both |
| `--search <text>` | Search textPayload for a substring (IP, email, uid, error message) | none | both |
| `--filter <expr>` | Raw gcloud logging filter expression (appended to built-in filters) | none | both |
| `--since <duration>` | Time range (`30m`, `1h`, `2d`, `1w`) | `1h` | read only |
| `--limit <n>` | Max entries | `300` | read only |
| `--order <dir>` | Sort order: `asc` (oldest first) or `desc` (newest first) | `desc` | read only |
| `--interval <sec>` | Polling interval in seconds | `5` | tail only |
| `--raw` | Output raw JSON | false | both |

## `--fn` Function Name Reference

The `--fn` flag uses the **deployed Cloud Function name**, not the route path.

**@omega.js/backend built-in functions (always deployed):**

| Function name | Type | Description |
|---------------|------|-------------|
| `omega_api` | HTTPS | Main API router — all consumer routes (GET/POST/PUT/DELETE) go through this |
| `omega_authBeforeCreate` | Auth blocking | Before user creation: disposable email blocking, IP rate limiting, consumer hooks |
| `omega_authBeforeSignIn` | Auth blocking | Before sign-in: consumer hooks |
| `omega_authOnCreate` | Auth event | After user creation: user doc setup |
| `omega_authOnDelete` | Auth event | After user deletion |
| `omega_paymentsWebhookOnWrite` | Firestore trigger | Processes payment webhooks |
| `omega_paymentsDisputeOnWrite` | Firestore trigger | Processes payment disputes |
| `omega_notificationsOnWrite` | Firestore trigger | Sends push notifications |
| `omega_cronDaily` | Scheduled | Daily cron (midnight UTC) |
| `omega_cronFrequent` | Scheduled | Frequent cron (every 10 min) |

**Consumer-defined functions** use the export name from `functions/index.js` (e.g., `exports.items = ...` → `--fn items`).

**Quick lookup — which function to query:**
- API route errors → `--fn omega_api`
- Signup/auth blocked → `--fn omega_authBeforeCreate`
- Sign-in issues → `--fn omega_authBeforeSignIn`
- User doc not created → `--fn omega_authOnCreate`
- Payment not processing → `--fn omega_paymentsWebhookOnWrite`
- Cron job issues → `--fn omega_cronDaily` or `--fn omega_cronFrequent`
