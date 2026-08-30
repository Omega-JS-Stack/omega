# The chat service — the brand's Chatsy agent

The `chat` service keeps the brand's support chat agent on [Chatsy](https://chatsy.ai) in
sync — settings plus knowledge — and sets the agent-owner account to the configured plan.
Agents live in Chatsy's OWN Firestore, so this is an OPERATOR service: it needs a service
account for Chatsy's Firebase project, and every other brand's clean skip is the sanctioned
outcome (the credential never gates a run).

## What it reconciles

- **`chat`** — the agent's managed fields (name, website, image from `brand.images.brandmark`)
  and its KNOWLEDGE: the packaged baseline with the brand's values filled in — `{website}`,
  `{description}`, `{pricing}` generated from `payment.products`, `{sponsorshipsUrl}` — plus
  the brand repo's `config/chatsy.md` appended when present. Diff-synced and patched with a
  LEAF MASK, so Chatsy-owned fields (owner, id, metadata, other settings) survive.
- **`user`** — the agent owner's subscription set to
  `inbound.chat.providers.chatsy.plan` (Chatsy's Max top tier by default) through the shared
  owner-plan reconciliation.

## Config

| Key | Meaning |
|---|---|
| `inbound.chat.providers.chatsy.enabled: false` (or `chatsy: false`) | Skip. |
| `inbound.chat.providers.chatsy.agentId` | The agent. Missing → minted (below) or asked for. |
| `inbound.chat.providers.chatsy.templateAgentId` | The shape donor for create-on-missing. |
| `inbound.chat.providers.chatsy.plan` | The owner account's plan (`plan.id` required). |
| `inbound.chat.providers.chatsy.sponsorshipsUrl` | The knowledge baseline's sponsorship link (default `{website}/contact`). |
| `inbound.chat.providers.chatsy.updateAgentInfo: false` | A shared agent another brand manages — never rewritten from here. |

A `web` target is required: the chat widget lives on the brand's website.

## The three auth tiers (Ian 2026-07-13)

1. **Operator SA** — `CHATSY_SERVICE_ACCOUNT` in the brand `.env`. Full create + manage: a
   missing `agentId` with a `templateAgentId` MINTS the brand's own agent (product user + doc
   templated from the donor), writes the id back, and converges name/knowledge/plan in the same
   run.
2. **User API key** — `CHATSY_API_KEY` is recognized; product-API management lands when those
   routes are verified.
3. **Dashboard** — an interactive run opens chatsy.ai and takes the pasted agent id, with a
   Disable option. Non-interactive and dry runs skip cleanly.

## Gotcha

An `agentId` that points at no document is a visible ERROR. omega-manager silently created an
orphan agent document instead; a wrong id should be fixed, not written around.
