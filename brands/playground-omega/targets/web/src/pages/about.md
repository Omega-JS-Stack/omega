---
# ═══ OMEGA Playground about page (see index.md header for the 2026-08-21
# rebrand rationale — the playground says what it is instead of wearing a
# fiction). Picture-first: the photo leads, a second sits beside the letter,
# the table band breaks the read. Then the familiar bands: timeline with era
# labels, principles, team CTA. Meta-only frontmatter.
layout: blueprint/about
permalink: /about
---

{% section "about/hero" %}
headline: "This whole site is <em>a demo</em>"
headline_accent: ""
description: "What {{ resolved.config.brand.name }} is, why it exists, and why nothing on it is real."
image: "/assets/images/about/office.jpg"
image_alt: "Writers at long wooden desks in a plant-filled studio, one of them writing in a notebook by a window"
facts:
  - number: "4"
    label: "Surfaces"
  - number: "1"
    label: "Config file"
  - number: "2"
    label: "Moods"
  - number: "0"
    label: "Real customers"
{% endsection %}
<!-- ═══ The letter: mission & vision ═══ -->
{% section "about/letter" %}
image: "/assets/images/about/desk.jpg"
image_alt: "An open notebook and fountain pen beside a laptop and a cup of coffee on a sunlit wooden desk"
mission:
  title: "Our mission"
  description: "Show what the OMEGA stack does without asking anyone to take our word for it: every framework running live, on real infrastructure, with the doors open and the <em>data</em> disposable."
vision:
  title: "Our vision"
  description: "A place where anything can be tried and nothing can be truly broken, so every idea gets proved <em>here</em> first and only the good ones reach a brand that matters."
{% endsection %}
<!-- ═══ The journey ═══ -->
{% section "about/timeline" %}
superheadline:
  text: "History"
headline: "A test brand, <em>out in the open</em>"
subheadline: "The small history of {{ resolved.config.brand.name }}."
items:
  - year: "Before"
    title: "Demos that proved nothing"
    description: "Screenshots, sample repos, and a happy path recorded once: everything looked fine right up until real infrastructure touched it"
  - year: "The idea"
    title: "One throwaway brand, wired for real"
    description: "Stand a whole brand up on real infrastructure, point every framework at it, and run the thing daily instead of describing it"
  - year: "The craft"
    title: "Four surfaces, one config"
    description: "The website, the backend, the desktop app, and the extension, all built from the same omega.json5 and sharing the same account"
  - year: "Next"
    title: "More to break"
    description: "Every new framework feature lands here first, in public, before any brand that matters ever sees it"
{% endsection %}
<!-- ═══ The table: one wide photo between the history and the principles ═══ -->
{% section "about/photo-band" %}
items:
  - src: "/assets/images/about/team.jpg"
    alt: "Four people talking and laughing around a wooden table with notebooks, mugs, and a laptop"
    caption: "One stack, every surface"
    wide: true
{% endsection %}
<!-- ═══ Principles ═══ -->
{% section "about/principles" %}
superheadline:
  text: "Principles"
headline: "What we <em>refuse</em> to compromise on"
subheadline: "Four principles, in order. When two collide, the smaller number wins."
items:
  - title: "Nothing here is real"
    description: "Every account, order, and page is test data. Sign up with an address you'll never read again and break whatever you like."
  - title: "It runs for real anyway"
    description: "Real hosting, real functions, real providers in test mode. A demo that fakes its own plumbing proves nothing about the stack."
  - title: "Broken here beats broken there"
    description: "Every feature lands on the playground first. If it falls over, it falls over where nobody is counting on it."
  - title: "It says what it is"
    description: "No invented company, no product to buy, no promises. This is the OMEGA stack demonstrating itself, and it never pretends otherwise."
{% endsection %}
<!-- ═══ Team CTA ═══ -->
{% section "marketing/cta" %}
superheadline:
  text: "People"
headline: "Meet the people behind {{ resolved.config.brand.name }}"
subheadline: "The people who build OMEGA, and run this playground on it."
primary_button:
  text: "Meet the team"
  href: "/team"
{% endsection %}
