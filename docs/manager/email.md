# The email service — the brand's Replyify agent

The `email` service keeps the brand's customer-service email agent on
[Replyify](https://replyify.app) in sync — its Gmail filter and its knowledge — and sets the
agent-owner account to the configured plan. Agents live in Replyify's OWN Firestore, so this
is an OPERATOR service, with the same clean-skip contract as forms and chat.

Not to be confused with `domain.email` (mailbox routing, owned by the `edge` service) or the
marketing lanes (`campaigns`, `newsletter`).

## What it reconciles

- **`agent`** — the FILTER is the brand's Gmail query (the `---filter---` section of the brand
  repo's `config/replyify.md`, or auto-generated as `to:(@domain)`) ANDed with the packaged
  baseline exclusion filter; the KNOWLEDGE is the packaged baseline plus that file's knowledge
  section. Diff-synced and patched with a leaf mask, so Replyify-owned fields survive.
- **`user`** — the agent owner's subscription set to
  `inbound.email.providers.replyify.plan` (Replyify's Max top tier by default) through the
  shared owner-plan reconciliation.

## Config

| Key | Meaning |
|---|---|
| `inbound.email.providers.replyify.enabled: false` (or `replyify: false`) | Skip. |
| `inbound.email.providers.replyify.agentId` | The agent. Missing → minted or asked for. |
| `inbound.email.providers.replyify.templateAgentId` | The shape donor for create-on-missing. |
| `inbound.email.providers.replyify.plan` | The owner account's plan. |
| `inbound.email.providers.replyify.updateAgentInfo: false` | A shared agent another brand manages. |

## The three auth tiers (Ian 2026-07-13)

1. **Operator SA** — `REPLYIFY_SERVICE_ACCOUNT` in the brand `.env`: full create + manage,
   minting the brand's own agent from `templateAgentId` and converging filter/knowledge/plan in
   the same run.
2. **User API key** — `REPLYIFY_API_KEY` is recognized; product-API management is not wired yet.
3. **Dashboard** — an interactive run opens replyify.app and takes the pasted agent id, with a
   Disable option.

## Gotcha

A wrong `agentId` is a visible error, never a silently created orphan document.
