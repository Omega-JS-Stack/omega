---
status: queued (Ian 2026-07-22, tabled during the cp259/cp260 arc)
created: 2026-07-22
---

# Assistant library review + optimization (backend `helpers/assistant.js`)

Ian's ask (2026-07-22, verbatim intent): "can you table a review+optimization of the whole assistant library? I made that thing so long ago and the functions are so disorganized and badly named and bad signatures. like sentry integration there is weird right? but I do like the headers and status codes management, I just think assistant is a bad name and should be [renamed] to something more sensible."

## Scope
- **Rename** the `assistant` concept (class `BackendAssistant`, the `{ assistant }` context key every route/schema/hook receives) to a sensible name. This touches the whole route contract — every handler, test, doc, and consumer project. Naming is Ian's call: propose candidates first.
- **Reorganize + rename functions, fix signatures** — the file is a grab-bag (auth, logging, request parsing, response, usage, errors). Likely split into focused modules per the one-concern-per-file rule.
- **Sentry integration** — Ian flags it as weird (errorify's `options.sentry`/`options.log` defaulting dance, capture inside the response path). Rework deliberately.
- **KEEP the semantics Ian likes**: the `omega-properties` header management and status-code handling (including the cp259 `headersSent` guards and code-clamping behavior).

## Constraints
- Consumer-facing contract change → migration story required (data-shape preservation ruling applies to route semantics; flag breaking changes with a plan, don't just build).
- Sequence AFTER cp260 (the legacy command lane deletion shrinks the surface first) and fits naturally with the wave 2 follow-up work.
- Propose the new name + module split to Ian before executing.
