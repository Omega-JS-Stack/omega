---
layout: blueprint/blog/index
permalink: "/blog{% if pagination.pageNumber > 0 %}/page/{{ pagination.pageNumber | plus: 1 }}{% endif %}.html"

# Eleventy pagination over the posts collection — replaces jekyll-paginate-v2
# (per_page 6 and the page/:num.html path mirror UJM's Jekyll pagination
# config). Layouts consume it through the engine's Jekyll `paginator` compat.
# generatePageOnEmptyData keeps /blog alive (empty state) for post-less brands.
pagination:
  data: collections.posts
  size: 6
  generatePageOnEmptyData: true

# NO eleventyExcludeFromCollections here, unlike every other paginated default
# (#564): /blog is the canonical blog listing and belongs in sitemap.xml, and
# a page cannot be listed in a walk it is not part of. Eleventy adds only page
# 0 of a paginated template to collections (TemplateMap: `counter === 0`), so
# this exposes /blog and never /blog/page/N — and a SUPPRESSED default (a
# consumer owns /blog) renders with `permalink: false`, which every machine
# file skips on `unless item.url`. The taxonomy generators keep the key: their
# `size: 1` pagination makes page 0 one arbitrary TERM.
---
