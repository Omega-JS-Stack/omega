---
layout: modules/utilities/redirect
permalink: /account

sitemap:
  include: false

# Permanent forwarding: the account page moved into the user app
# (/dashboard/account). Old emails, bookmarks, and muscle memory keep working;
# the redirect module carries querystrings AND the #section fragment along.
redirect:
  url: "/dashboard/account"
---
