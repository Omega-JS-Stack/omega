---
# ═══ Content pass A (spec §13 step 3, Ian greenlit 2026-07-18): the real
# OMEGA pitch as a composition — this page is the living draft of the real
# omegajs.dev homepage (the fork copies it 1:1; {{ site.brand.name }} stays
# a variable so the real brand's name lands at fork time). Every band below
# is TRUE today: no invented logos, quotes, or numbers — trusted-by,
# product-demo, showcase, and testimonials are deliberately absent until
# real ones exist (absence is the spine).
layout: blueprint/index
permalink: /

# ─── Hero: the terminal IS the product shot (frame mock off — that generic
# SaaS dashboard isn't this product; the demo_html slot below carries a real
# session instead)
hero:
  badge:
    text: "The open JavaScript stack"
    href: null
  headline: "One brand config for"
  rotating:
    - "every surface"
    - "your website"
    - "your backend"
    - "your desktop app"
    - "your extension"
  description: "{{ site.brand.name }} turns a single omega.json5 into a complete product — static website, Firebase backend, desktop app, and browser extension — with auth, payments, theming, and deploys wired from day one."
  primary_button:
    text: "Get started"
    href: "/download"
  command: "npx omega setup"
  command_href: "/download"
  secondary_button:
    enabled: false
  meta:
    - "Web · Backend · Desktop · Extension"
    - "Static-first websites"
    - "Secrets never live in config"
  frame:
    enabled: false

# ─── Bento: the six real capabilities, typed tiles
bento:
  superheadline: "Why {{ site.brand.name }}"
  headline: "Everything wired. <em>Nothing invented twice.</em>"
  subheadline: "One config file drives every target — change it once and every surface follows."
  items:
    - type: "code"
      span: "big"
      icon: "sliders"
      title: "One config, every surface"
      description: "omega.json5 names your brand, targets, and services once — pages, emails, builds, and stores all read the same truth. Secrets stay in .env; the loader refuses them anywhere else."
    - type: "split"
      span: "tall"
      icon: "circle-half-stroke"
      title: "Light & dark, born together"
      description: "The design-token sheet ships both modes from day one — no bolted-on dark theme, ever."
    - type: "terminal"
      icon: "terminal"
      title: "Deploys are deliberate"
      description: "Nothing publishes on commit. One verb — omega deploy — builds, verifies, and ships the surface you name."
    - type: "brand"
      icon: "palette"
      title: "Your color, everywhere"
      description: "One brand color becomes full light + dark accent ramps — buttons, links, focus rings, charts."
    - type: "default"
      icon: "shield-halved"
      title: "Auth & accounts built in"
      description: "Sign-in, subscriptions, and billing flows arrive wired to your backend on day one."
    - type: "default"
      icon: "puzzle-piece"
      title: "Pages are compositions"
      description: "Every page is section calls over your data — swap themes and the same content reskins itself."

# ─── Stats: honest numbers only
stats:
  - number: "4"
    label: "Targets from one config"
    sublabel: "Web · backend · desktop · extension"
  - number: "1"
    label: "Config file per brand"
    sublabel: "omega.json5 — secrets stay in .env"
  - number: "2"
    label: "First-party themes"
    sublabel: "classy & newsflash, light + dark"
  - number: "100%"
    label: "Static web output"
    sublabel: "Nothing to patch on a Sunday"

# ─── CTA: the command is the call
cta:
  superheadline:
    icon: "rocket"
    text: "Get started"
  headline: "Ship every surface"
  headline_accent: "from one command"
  subheadline: "{{ site.brand.name }} scaffolds the brand, wires the targets, and boots your dev stack — then gets out of your way."
  command: "npx omega setup"
  command_href: "/download"
  secondary_button:
    text: "See pricing"
    href: "/pricing"
    nudge: true

composition: true
---

{% section "marketing/hero", data: resolved.hero %}
  {% slot demo_html %}
    <div class="classy-tile__term classy-ink-panel col-lg-7 mx-auto text-start">
      <div><span class="classy-term__prompt">$</span> npx omega setup</div>
      <div class="classy-term__out"><span class="classy-term__ok">✓</span> brand config → omega.json5</div>
      <div class="classy-term__out"><span class="classy-term__ok">✓</span> targets: website · backend · desktop · extension</div>
      <div><span class="classy-term__prompt">$</span> omega dev</div>
      <div class="classy-term__out">● website&nbsp;&nbsp;https://localhost:4000</div>
      <div class="classy-term__out">● backend&nbsp;&nbsp;emulators up<span class="omega-caret"></span></div>
    </div>
  {% endslot %}
{% endsection %}
<!-- ═══ Bento ═══ -->
{% section "marketing/bento", data: resolved.bento %}
<!-- ═══ Stats band ═══ -->
{% section "marketing/stats", items: resolved.stats %}
<!-- ═══ CTA band ═══ -->
{% section "marketing/cta", data: resolved.cta %}
