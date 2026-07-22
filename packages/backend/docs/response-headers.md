# Response Headers

@omega.js/backend automatically sets `omega-properties` header with:
- `code`: HTTP status code
- `tag`: Function name and execution ID
- `usage`: Current usage stats
- `schema`: Resolved schema info

The header rides every `assistant.respond()`/`errorify()` response (exposed via `Access-Control-Expose-Headers`) and is consumed automatically by @omega.js/client's `omega.request()`, which merges `usage.current` + `usage.limits` into the frontend `usage` bindings key — `data-omega-bind` elements refresh after every API call.
