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

<!-- ═══ Hero: a build IS the product shot (frame mock off, since the demo_html
     slot carries a living build log instead: classy's ink-panel classes make
     a terminal vignette for free) ═══ -->
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
description: "{{ site.brand.name }} is where the OMEGA stack runs in the open: real builds, real sign-ins, real checkouts — on a brand nobody has to keep."
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
{% slot demo_html %}
    <div class="classy-tile__term classy-ink-panel col-lg-7 mx-auto text-start">
      <div class="classy-term__out">$ omega build</div>
      <div>website · backend · desktop · extension</div>
      <div>one config, four surfaces<span class="omega-caret"></span></div>
      <div class="classy-term__out"><span class="classy-term__ok">✓</span> shipped · and none of it is production</div>
    </div>
{% endslot %}
{% endsection %}
<!-- ═══ Bento: six things the stack does, one per tile type (same tile-type
     coverage as before: code, split, terminal, brand, default ×2) ═══ -->
{% section "marketing/bento" %}
superheadline: "Why {{ site.brand.name }} exists"
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
    description: "Change one hex in omega.json5 and {{ site.brand.name }} re-inks itself: buttons, links, highlights, focus rings."
  - type: "default"
    icon: "flask"
    title: "Throwaway by design"
    description: "Sign up, subscribe, cancel, break it. Every account, order, and page here is test data, and nothing is production."
  - type: "default"
    icon: "plug"
    title: "Real integrations, test mode"
    description: "Auth, payments, email, analytics, and ads are wired to the real providers in test mode, so a whole flow can be walked end to end."
{% endsection %}
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
  icon: "rocket"
  text: "Try it"
headline: "Take the whole stack"
headline_accent: "for a spin"
subheadline: "{{ site.brand.name }} makes you a test account in a minute: sign in, subscribe, cancel, and see how OMEGA behaves when it's wired up for real."
primary_button:
  text: "Create a test account"
  href: "/signup"
secondary_button:
  text: "See pricing"
  href: "/pricing"
  nudge: true
{% endsection %}
