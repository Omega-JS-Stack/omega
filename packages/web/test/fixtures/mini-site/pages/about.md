---
layout: blueprint/index
permalink: /about
meta:
  title: "About - {{ site.brand.name }}"
# The deliberate append-contract exercise: meta-only frontmatter (the
# content-key guard is exercised in frontmatter-guard.test.js), extra body
# BELOW the layout composition (a body without this flag would REPLACE the
# composition — Ian's 2026-07-19 default).
append: true
---

Consumer body content here.
