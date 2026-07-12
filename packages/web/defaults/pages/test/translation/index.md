---
layout: frontend/core/minimal
permalink: /test/translation

sitemap:
  include: false
meta:
  title: "Test translation page"
  description: "This is a test Translation page for the Ultimate Jekyll Manager."
  breadcrumb: "Test translation page"
  index: false

web_manager:
  exitPopup:
    enabled: false
---

{% capture brand %}**{{ site.brand.name | uj_liquify }}**{% endcapture %}
{% capture breadcrumb %}{{ resolved.meta.breadcrumb | uj_liquify }}{% endcapture %}

### Effective date: <span class="text-primary">8th of April, 2017</span>
<hr>

Welcome to [{{ site.url }}]({{ site.url }}). This website is owned and operated by {{ brand }} ("{{ brand }}", "we", "us", or "our"), a brand that is a part of our parent company, **ITW Creative Works**.

By vising {{ brand }}, you agree to comply.

## Test External URL
- External URL: [https://www.google.com](https://www.google.com)

## Test Internal URL
- Relative URL: [/test-page](/test-page)
- Absolute URL: [{{ site.url }}/test-page]({{ site.url }}/test-page)

## Test Anchor URL
- Anchor URL: [#test-anchor](#test-anchor)
- Blank Anchor URL: [#](#)

## Test Ignored URL
- Account page: [/account](/account)
- Admin page: [/admin](/admin)
- Admin sub-page: [/admin/subpage](/admin/subpage)

## This is an input
<div class="form-group">
  <label for="test-email" class="visually-hidden">Your email</label>
  <input type="email" id="test-email" name="email" class="form-control" placeholder="Your email">
</div>

## This button has a title
<a href="https://itwcreativeworks.com" class="btn btn-primary" title="Visit ITW Creative Works">Visit ITW Creative Works</a>
