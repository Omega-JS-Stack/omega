---
layout: blueprint/index
permalink: /about
# Meta-only frontmatter with NO body: the layout's own composition is the
# page (the content-key guard is exercised in frontmatter-guard.test.js).
# A body would REPLACE that composition — Ian's 2026-07-19 rule, and since
# #607 there is no `append:` flag to keep both.
meta:
  title: "About - {{ resolved.config.brand.name }}"
---
