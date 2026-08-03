---
layout: blueprint/blog/post
post:
  title: "The case for one config"
  description: "Why every surface of this product reads from a single source of truth, and what that buys you in practice."
  id: 9000004
  image: "/assets/images/core/placeholder/photo-2.jpg"
  categories: ["Product"]
  tags: ["product", "architecture"]
---

Ask any team where their brand color is defined and you'll usually get a list: the website has one, the app has another, the emails have a third that someone eyeballed in 2023. None of them are wrong, exactly. They've just drifted, the way anything defined in five places always drifts.

We took the opposite bet: **one config, every surface**. The name, the colors, the links, the plans: defined once, consumed everywhere.

## What "everywhere" means

When a value lives in exactly one place, changing it is an edit, not a project:

- Rename the product → every page title, email footer, and app menu follows.
- Change the accent color → the site, the dashboard, and the extension repaint together.
- Update a price → the pricing page, the checkout, and the receipts all agree.

The alternative isn't hypothetical. It's the bug report that says "the website says $12 but checkout charged $15," and the afternoon you lose figuring out which one was right.

## The discipline it takes

Single-source-of-truth is a habit you defend, not a feature you install. The temptation is always the quick fix: hardcode it here, just this once, we'll clean it up later. Every one of those is a small loan against the system, and the interest compounds.

Our rule: if you're about to type a value that already exists somewhere else, stop. Reference it. If you can't reference it, that's an architecture bug worth fixing before the feature ships.

## Where it pays off most

Honestly? Onboarding. A new teammate who finds one well-documented config file understands the product's shape in an afternoon. The same teammate facing five scattered definitions learns the shape the way everyone else did: by breaking something.

One config. Every surface. It's less exciting than it is correct, and we'll take that trade every time.
