---
# ═══ OMEGA Playground content pass (Ian 2026-08-21: the playground drops the
# fiction and says what it is — the live OMEGA test surface, where nothing is
# production and every account is throwaway). Structure is UNCHANGED: the same
# bands the real brand exercises (hero + rotating + slot, bento, stats, cta),
# so this brand keeps stress-testing every section shape the framework ships;
# only the voice moved.
#
# Authoring form: PURE composition — frontmatter carries page meta only;
# every band's words live inside its own section call (spec §5 block-YAML).
layout: blueprint/index
permalink: /
meta:
  title: "OMEGA Playground: see what OMEGA can do"
  description: "The live demo surface for the OMEGA stack: real builds, real sign-ins, real checkouts, on a brand nobody has to keep."
---

<!-- ═══ Hero: the stack IS the product shot (frame mock off — the custom
     animation slot carries the framework's `orbit` reference instead, #441:
     one folder of markup + style.scss + script.js, resolved through the layer
     chain and bundled like a section's assets) ═══ -->
{% section "marketing/hero" %}
badge:
  text: "The OMEGA test surface"
  href: null
headline: "One stack for"
rotating:
  - "your website"
  - "your backend"
  - "your desktop app"
  - "your extension"
  - "your whole brand"
description: "{{ resolved.config.brand.name }} is where the OMEGA stack runs in the open: real builds, real sign-ins, real checkouts — on a brand nobody has to keep."
primary_button:
  text: "Create a test account"
  href: "/signup"
secondary_button:
  text: "See pricing"
  href: "/pricing"
meta:
  - "Web · Backend · Desktop · Extension"
  - "Running on real infrastructure"
  - "Every account here is throwaway"
frame:
  enabled: false
demo:
  enabled: true
  type: "custom"
  name: "orbit"
  options:
    subtext: "One config in the middle, four surfaces around it"
{% endsection %}
<!-- ═══ Bento: six things the stack does, one per tile type (same tile-type
     coverage as before: code, split, terminal, brand, default ×2) ═══ -->
{% section "marketing/bento" %}
superheadline: "Why {{ resolved.config.brand.name }} exists"
headline: "Everything the stack does. <em>Running, right now.</em>"
subheadline: "Every framework and every integration, exercised live — so you can poke at it before you build on it."
config_demo:
  label: "// omega.json5: one config, every surface"
items:
  - type: "code"
    span: "big"
    icon: "cubes"
    title: "One stack, four surfaces"
    description: "The website, the backend, the desktop app, and the browser extension all build from one config and share one account. What you're clicking is the same code a real brand ships."
  - type: "split"
    span: "tall"
    icon: "circle-half-stroke"
    title: "Light and dark, for free"
    description: "Both moods come from a single brand color in config, built in from the first build — flip the toggle and watch."
  - type: "terminal"
    icon: "terminal"
    title: "One command builds it"
    description: "No bespoke pipeline behind the curtain. This site, and every other surface, comes out of the same verb."
    terminal:
      command: "omega build"
  - type: "brand"
    icon: "palette"
    title: "Rebrand in one line"
    description: "Change one hex in omega.json5 and {{ resolved.config.brand.name }} re-inks itself: buttons, links, highlights, focus rings."
  - type: "default"
    icon: "flask"
    title: "Throwaway by design"
    description: "Sign up, subscribe, cancel, break it. Every account, order, and page here is test data, and nothing is production."
  - type: "default"
    icon: "plug"
    title: "Real integrations, test mode"
    description: "Auth, payments, email, analytics, and ads are wired to the real providers in test mode, so a whole flow can be walked end to end."
{% endsection %}
<!-- ═══ Plan cards: the same catalog /pricing renders, right under the WHY
     band — plans and billing bridge from resolved.pricing, so nothing here is
     a copied number ═══ -->
{% section "marketing/pricing-cards", plans: resolved.pricing.plans, annual: resolved.pricing.billing.annually, superheadline: "Pricing", headline: "Test plans, priced like", headline_accent: "the real thing", subheadline: "Every tier here is a throwaway test product: subscribe, switch, and cancel as often as you like." %}
<!-- ═══ Stats band: the playground's shape in four numbers ═══ -->
{% section "marketing/stats" %}
items:
  - number: "4"
    label: "Surfaces exercised"
    sublabel: "Web · backend · desktop · extension"
  - number: "1"
    label: "Config file"
    sublabel: "omega.json5 drives all of them"
  - number: "2"
    label: "Moods"
    sublabel: "Light & dark, from one color"
  - number: "0"
    label: "Real customers"
    sublabel: "Everything here is test data"
{% endsection %}
<!-- ═══ CTA band ═══ -->
{% section "marketing/cta" %}
superheadline:
  text: "Try it"
headline: "Take the whole stack"
headline_accent: "for a spin"
subheadline: "{{ resolved.config.brand.name }} makes you a test account in a minute: sign in, subscribe, cancel, and see how OMEGA behaves when it's wired up for real."
primary_button:
  text: "Create a test account"
  href: "/signup"
secondary_button:
  text: "See pricing"
  href: "/pricing"
  nudge: true
{% endsection %}
