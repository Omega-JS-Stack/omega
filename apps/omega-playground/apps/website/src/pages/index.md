---
# ═══ Paperloom content pass (Ian 2026-07-19: the playground rebrands to its
# OWN fictional concept — a quiet writing studio — so drift from the real
# omegajs.dev site never reads as a broken copy). Structure is UNCHANGED:
# the same bands the real brand exercises (hero + rotating + slot, bento,
# stats, cta), so this brand keeps stress-testing every section shape the
# framework ships; only the voice is fiction.
#
# Authoring form: PURE composition — frontmatter carries page meta only;
# every band's words live inside its own section call (spec §5 block-YAML).
layout: blueprint/index
permalink: /
---

<!-- ═══ Hero: a page-in-progress IS the product shot (frame mock off — the
     demo_html slot carries a living draft instead; classy's ink-panel
     classes make an editor vignette for free) ═══ -->
{% section "marketing/hero" %}
badge:
  text: "A quiet place to write"
  href: null
headline: "One home for"
rotating:
  - "every draft"
  - "your notes"
  - "your journals"
  - "your clippings"
  - "your finished pages"
description: "{{ site.brand.name }} keeps your writing in one calm place — capture from any tab, shape it at your desk, and publish pages you're proud of."
primary_button:
  text: "Start writing"
  href: "/signup"
secondary_button:
  text: "See pricing"
  href: "/pricing"
meta:
  - "Capture · Draft · Publish"
  - "Synced everywhere you write"
  - "Your words stay yours"
frame:
  enabled: false
{% slot demo_html %}
    <div class="classy-tile__term classy-ink-panel col-lg-7 mx-auto text-start">
      <div class="classy-term__out">Tuesday, 9:12 AM — draft</div>
      <div>The lighthouse keeper kept two logs: one for the sea,</div>
      <div>one for everything the sea took.<span class="omega-caret"></span></div>
      <div class="classy-term__out"><span class="classy-term__ok">✓</span> saved · waiting at your desk</div>
    </div>
{% endslot %}
{% endsection %}
<!-- ═══ Bento: six product truths, one per tile type (same tile-type
     coverage as before — code, split, terminal, brand, default ×2) ═══ -->
{% section "marketing/bento" %}
superheadline: "Why {{ site.brand.name }}"
headline: "Everything in its place. <em>Nothing lost again.</em>"
subheadline: "Capture anywhere, and it's waiting at your desk — organized, synced, and yours."
config_demo:
  label: "// tuesday.md — one page, every device"
items:
  - type: "code"
    span: "big"
    icon: "book"
    title: "One library, every device"
    description: "Your notes live in a single library that follows you — the web app, the writing desk, and the clipper all read the same pages. Offline first; sync catches up when you do."
  - type: "split"
    span: "tall"
    icon: "circle-half-stroke"
    title: "Paper by day, ink by night"
    description: "A warm page in daylight, a quiet dark desk after hours — both built in from the first word."
  - type: "terminal"
    icon: "feather"
    title: "Saving is invisible"
    description: "Every keystroke lands in your library — close the lid mid-sentence and pick the sentence back up anywhere."
    terminal:
      command: "autosave · on"
  - type: "brand"
    icon: "palette"
    title: "Make it yours"
    description: "Pick an ink and {{ site.brand.name }} re-inks itself — covers, links, highlights, focus rings."
  - type: "default"
    icon: "shield-halved"
    title: "Private by default"
    description: "Your library is yours alone until you say otherwise — sharing is a deliberate act, page by page."
  - type: "default"
    icon: "book-open"
    title: "Journals & collections"
    description: "Group pages into journals, thread drafts into collections, and let finished work shelve itself."
{% endsection %}
<!-- ═══ Stats band: the product's shape in four numbers ═══ -->
{% section "marketing/stats" %}
items:
  - number: "3"
    label: "Places to write"
    sublabel: "Browser · desk · clipper"
  - number: "1"
    label: "Library, synced"
    sublabel: "Every device reads the same pages"
  - number: "2"
    label: "Moods"
    sublabel: "Paper light & ink dark"
  - number: "100%"
    label: "Yours"
    sublabel: "Export everything, anytime"
{% endsection %}
<!-- ═══ CTA band ═══ -->
{% section "marketing/cta" %}
superheadline:
  icon: "feather"
  text: "Begin"
headline: "Start your first page"
headline_accent: "tonight"
subheadline: "{{ site.brand.name }} sets up your library in a minute — then gets out of the way of the words."
primary_button:
  text: "Start writing"
  href: "/signup"
secondary_button:
  text: "See pricing"
  href: "/pricing"
  nudge: true
{% endsection %}
