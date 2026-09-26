---
# Surface: a page, composed of section calls
# Doc: node_modules/@omega.js/web/docs/frontmatter.md
#
# The auth policy sends a signed-out visitor to sign in before the page runs,
# so the page itself never waits on auth to decide what to draw. A page nobody
# signed out can see stays out of the index and the machine files.
layout: frontend/core/base
permalink: /notes
meta:
  title: "Notes - {{ resolved.config.brand.name }}"
  description: "One small feature wired through every surface: a route, a schema, a trigger, a rule, and the page you are reading."
  index: false
config:
  client:
    auth:
      config:
        policy: "authenticated"
---

{% section "marketing/prose" %}
superheadline: "Notes"
headline: "One feature,"
headline_accent: "every surface"
subheadline: "A note you write here travels through a backend route, a schema, a Firestore trigger and a security rule, then comes back through bindings."
{% endsection %}
{% section "notes-list" %}
