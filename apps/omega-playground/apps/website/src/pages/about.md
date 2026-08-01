---
# ═══ Paperloom about page (fiction voice — see index.md header for the
# 2026-07-19 rebrand rationale). Picture-first: the studio photo leads, the
# desk sits beside the letter, the table band breaks the read. Then the
# familiar bands: timeline with era labels, principles, team CTA. Meta-only
# frontmatter.
layout: blueprint/about
permalink: /about
---

{% section "about/hero" %}
headline: "Writing deserves <em>a quiet room</em>"
headline_accent: ""
description: "Why {{ site.brand.name }} exists, and the small stubborn ideas holding it together."
image: "/assets/images/about/office.jpg"
image_alt: "Writers at long wooden desks in a plant-filled studio, one of them writing in a notebook by a window"
facts:
  - number: "3"
    label: "Places to write"
  - number: "1"
    label: "Library"
  - number: "2"
    label: "Moods"
  - number: "100%"
    label: "Yours"
{% endsection %}
<!-- ═══ The letter: mission & vision ═══ -->
{% section "about/letter" %}
image: "/assets/images/about/desk.jpg"
image_alt: "An open notebook and fountain pen beside a laptop and a cup of coffee on a sunlit wooden desk"
mission:
  title: "Our mission"
  description: "Give every writer one calm, trustworthy home for their words: capture anywhere, shape it at the desk, publish with pride, so the time goes into the <em>writing</em>, never the filing."
vision:
  title: "Our vision"
  description: "A world where no good sentence dies in a lost tab, where your library outlives your devices, your apps, and your worst backup habits. The tools <em>disappear</em>; the pages are all anyone sees."
{% endsection %}
<!-- ═══ The journey ═══ -->
{% section "about/timeline" %}
superheadline:
  icon: "clock-rotate-left"
  text: "History"
headline: "Scattered words became <em>one library</em>"
subheadline: "The small history of {{ site.brand.name }}."
items:
  - year: "Before"
    title: "Words everywhere, library nowhere"
    description: "Notes in one app, drafts in another, clippings in bookmarks, every good idea filed somewhere it would never be found again"
  - year: "The idea"
    title: "One library"
    description: "Paperloom began as a single stubborn rule: every word you write lands in the same library, no matter where you wrote it"
  - year: "The craft"
    title: "The desk, the page, the clipper"
    description: "The writing desk for long mornings, the web app for anywhere, the clipper for everything worth keeping, all reading one library"
  - year: "Next"
    title: "Shelves for everyone"
    description: "Shared journals, small-press publishing, and a library that grows old gracefully with you"
{% endsection %}
<!-- ═══ The table: one wide photo between the history and the principles ═══ -->
{% section "about/photo-band" %}
items:
  - src: "/assets/images/about/team.jpg"
    alt: "Four people talking and laughing around a wooden table with notebooks, mugs, and a laptop"
    caption: "One table, one library"
    wide: true
{% endsection %}
<!-- ═══ Principles ═══ -->
{% section "about/principles" %}
superheadline:
  icon: "compass"
  text: "Principles"
headline: "What we <em>refuse</em> to compromise on"
subheadline: "Four principles, in order. When two collide, the smaller number wins."
items:
  - title: "The library is sacred"
    description: "Every word lands in one place. No second brains, no sync conflicts, no orphaned drafts."
  - title: "Capture must be effortless"
    description: "If saving a thought takes more than a heartbeat, the thought is gone. One keystroke, filed."
  - title: "Publishing is deliberate"
    description: "Nothing leaves your library because you hovered somewhere. Sharing is a verb you say out loud."
  - title: "Your words are yours"
    description: "Export everything, anytime, in formats that outlive us. Lock-in is a betrayal of writing."
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
