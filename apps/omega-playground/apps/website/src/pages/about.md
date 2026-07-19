---
# ═══ Content pass A: the real OMEGA story (living draft — the fork copies
# this 1:1). Era labels instead of invented years; gallery off until real
# photos exist. The values ARE the project's actual working principles.
layout: blueprint/about
permalink: /about

hero:
  headline: "One config should ship <em>every surface</em>"
  headline_accent: ""
  description: "Why {{ site.brand.name }} exists, and the stubborn opinions holding it together."

mission:
  title: "Our mission"
  description: "Make one brand config the whole machine — website, backend, desktop, extension — so builders spend their time on the <em>product</em>, never the plumbing."
  icon: "bullseye"

vision:
  title: "Our vision"
  description: "A stack where launching your fourth surface is as boring as your first — configure it, compose it, ship it. The machinery <em>disappears</em>; the brand is all anyone sees."
  icon: "lightbulb"

story:
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

gallery: false

stats:
  superheadline:
    icon: "chart-line"
    text: "Numbers"
  headline: "The shape of the <em>stack</em>"
  subheadline: "What one brand config carries."
  items:
    - number: "4"
      label: "Targets"
      icon: "layer-group"
    - number: "1"
      label: "Config file"
      icon: "sliders"
    - number: "2"
      label: "First-party themes"
      icon: "palette"
    - number: "100%"
      label: "Static web output"
      icon: "file-code"

values:
  superheadline:
    icon: "compass"
    text: "Principles"
  headline: "What we <em>refuse</em> to compromise on"
  subheadline: "Four principles, in order. When two collide, the smaller number wins."
  items:
    - title: "Preserve semantics, replace plumbing"
      description: "Upgrades never make you relearn your own project. The machinery changes; your contract doesn't."
      icon: "handshake"
    - title: "Absence is the spine"
      description: "Delete a key and the surface disappears. No dead switches, no zombie config."
      icon: "eraser"
    - title: "Deploys are deliberate"
      description: "Nothing publishes because you committed. Shipping is a verb you say out loud."
      icon: "rocket"
    - title: "One home per fact"
      description: "Every value lives in exactly one place — and secrets never live in config."
      icon: "key"

team_cta:
  superheadline:
    icon: "handshake"
    text: "People"
  headline: "Meet the people behind {{ site.brand.name }}"
  subheadline: "The people who build and run it, every day."
  primary_button:
    text: "Meet the team"
    href: "/team"
---
