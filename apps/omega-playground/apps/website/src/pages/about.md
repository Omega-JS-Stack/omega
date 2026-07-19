---
# ═══ Content pass A: the real OMEGA story as a PURE composition (Ian's
# rule, 2026-07-19: consumer frontmatter carries page meta ONLY — every
# band's words live inside its own section call). Era labels instead of
# invented years; no photo band until real photos exist (absence is the
# spine); the values ARE the project's actual working principles.
layout: blueprint/about
permalink: /about
---

{% section "about/hero" %}
headline: "One config should ship <em>every surface</em>"
headline_accent: ""
description: "Why {{ site.brand.name }} exists, and the stubborn opinions holding it together."
facts:
  - number: "4"
    label: "Targets"
  - number: "1"
    label: "Config file"
  - number: "2"
    label: "First-party themes"
  - number: "100%"
    label: "Static web output"
{% endsection %}
<!-- ═══ The letter — mission & vision ═══ -->
{% section "about/letter" %}
mission:
  title: "Our mission"
  description: "Make one brand config the whole machine — website, backend, desktop, extension — so builders spend their time on the <em>product</em>, never the plumbing."
vision:
  title: "Our vision"
  description: "A stack where launching your fourth surface is as boring as your first — configure it, compose it, ship it. The machinery <em>disappears</em>; the brand is all anyone sees."
{% endsection %}
<!-- ═══ The journey ═══ -->
{% section "about/timeline" %}
superheadline:
  icon: "clock-rotate-left"
  text: "History"
headline: "Five frameworks became <em>one stack</em>"
subheadline: "The consolidation that produced {{ site.brand.name }}."
items:
  - year: "Before"
    title: "Five managers, one job each"
    description: "A backend manager, a website manager, a desktop manager, an extension manager, a shared web library — each carried one surface, each solved the same problems its own way"
  - year: "2026"
    title: "One stack"
    description: "The OMEGA monorepo unified them: one config format, one CLI, one section library, shared theming — with every consumer's semantics preserved"
  - year: "2026"
    title: "Pages became compositions"
    description: "The section library landed: every page is composition calls over your data, themes reskin the same content, and a showcase documents every band automatically"
  - year: "Next"
    title: "In the open"
    description: "Published packages, real brands, and the same one-command birth for everyone: npx omega setup"
{% endsection %}
<!-- ═══ Principles ═══ -->
{% section "about/principles" %}
superheadline:
  icon: "compass"
  text: "Principles"
headline: "What we <em>refuse</em> to compromise on"
subheadline: "Four principles, in order. When two collide, the smaller number wins."
items:
  - title: "Preserve semantics, replace plumbing"
    description: "Upgrades never make you relearn your own project. The machinery changes; your contract doesn't."
  - title: "Absence is the spine"
    description: "Delete a key and the surface disappears. No dead switches, no zombie config."
  - title: "Deploys are deliberate"
    description: "Nothing publishes because you committed. Shipping is a verb you say out loud."
  - title: "One home per fact"
    description: "Every value lives in exactly one place — and secrets never live in config."
{% endsection %}
<!-- ═══ Team CTA ═══ -->
{% section "marketing/cta" %}
superheadline:
  icon: "handshake"
  text: "People"
headline: "Meet the people behind {{ site.brand.name }}"
subheadline: "The people who build and run it, every day."
primary_button:
  text: "Meet the team"
  href: "/team"
{% endsection %}
