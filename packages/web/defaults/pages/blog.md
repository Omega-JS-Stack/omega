---
layout: blueprint/blog/index
permalink: "/blog/{% if pagination.pageNumber > 0 %}page/{{ pagination.pageNumber | plus: 1 }}.html{% endif %}"

# Eleventy pagination over the posts collection — replaces jekyll-paginate-v2
# (per_page 6 and the page/:num.html path mirror UJM's Jekyll pagination
# config). Layouts consume it through the engine's Jekyll `paginator` compat.
pagination:
  data: collections.posts
  size: 6
eleventyExcludeFromCollections: true
---
