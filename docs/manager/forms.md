# The forms service — the brand's Slapform contact form

The `forms` service keeps the brand's contact form on [Slapform](https://slapform.com) in sync
and sets the form-owner account to the configured plan, so the brand has full access. Forms
live in Slapform's OWN Firestore, which makes this an OPERATOR service: it needs a service
account for Slapform's Firebase project. Every other brand answers "Disable permanently" once
and is never asked again — that clean skip is the sanctioned outcome, which is why the
credential never gates a run.

## What it reconciles

- **`form`** — the form document's name (`Contact Form - {brand.name}`) and `settings.enabled`,
  diff-synced: read first, patched only on drift.
- **`user`** — the form owner's account subscription set to
  `forms.providers.slapform.plan` (Slapform's top tier by default), through the shared
  owner-plan reconciliation. The form document carries the owner UID.

## Config

| Key | Meaning |
|---|---|
| `forms.providers.slapform.enabled: false` (or `slapform: false`) | Skip. |
| `forms.providers.slapform.formId` | The form. Missing → minted (below) or asked for interactively. |
| `forms.providers.slapform.templateFormId` | The company layer's shape donor for create-on-missing. |
| `forms.providers.slapform.plan` | The owner account's plan (`plan.id` required). |
| `forms.providers.slapform.updateFormInfo: false` | The form is shared and another brand owns its branding — never renamed or re-enabled from here. |

The service also requires a `web` target: the contact form lives on the brand's website.

## The three auth tiers (Ian 2026-07-13)

1. **Operator SA** — `SLAPFORM_SERVICE_ACCOUNT` in the brand `.env` (path to the
   service-account JSON, absolute or brand-root-relative). Full create + manage: a missing
   `formId` with a `templateFormId` configured MINTS the brand's own form — a product user
   (email = brand contact email, password through the account service's owner channels) plus a
   doc shape-templated from the donor — writes the new id back into omega.json5, and the
   ensures converge name/settings/plan in the SAME run.
2. **User API key** — `SLAPFORM_API_KEY` is recognized, but management through the product's
   public API lands when those routes are verified; today it is a named skip.
3. **Dashboard** — an interactive run opens slapform.com and takes the pasted form id
   (comment-preserving writeback, with a Disable option). Non-interactive and dry runs skip
   cleanly.

## Gotcha

A `formId` that points at no document is an ERROR, not a create: omega-manager silently
created a name-only orphan document in that case. Fix the id, or let the operator tier mint
one.
