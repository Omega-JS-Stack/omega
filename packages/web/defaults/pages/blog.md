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
eleventyExcludeFromCollections: true
---
