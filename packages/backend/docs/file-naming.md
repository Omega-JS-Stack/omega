# File Naming Conventions

| Type | Location | Naming |
|------|----------|--------|
| Routes | `routes/{name}/` | `index.js` or `{method}.js` |
| Schemas | `schemas/{name}/` | `index.js` or `{method}.js` |
| Auth Events | `events/auth/` | `{event}.js` |
| Auth Hooks (consumer) | `hooks/auth/` | `{event}.js` |
| Cron Jobs (@omega.js/backend) | `events/cron/daily/` | `{job}.js` |
| Cron Jobs (consumer) | `hooks/cron/daily/` | `{job}.js` |
