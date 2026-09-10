---
layout: modules/utilities/redirect
permalink: /dashboard

# The user app's root. No default homepage ships (cp173: nothing real to show
# a generic user) — the root forwards to the account page. A brand that
# scaffolds its own /dashboard page suppresses this redirect automatically.
redirect:
  url: "/dashboard/account"
meta:
  index: false
---
