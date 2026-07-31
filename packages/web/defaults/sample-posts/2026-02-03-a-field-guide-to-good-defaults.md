---
layout: blueprint/blog/post
post:
  title: "A field guide to good defaults"
  description: "Most settings screens are a tax on your attention. Here's how we decide what becomes a default, what becomes an option, and what gets deleted."
  id: 9000002
  image: false
  categories: ["Design"]
  tags: ["design", "product"]
---

Every option you add to a product is a question you're asking every future user. Most of them didn't come here to answer questions. They came to get something done.

That's why the highest-leverage design work isn't drawing screens. It's deciding what people should never have to think about. This post is the checklist we run before anything becomes a setting.

## The three buckets

Every proposed option lands in exactly one bucket:

| Bucket | Test | What happens |
|---|---|---|
| Default | 90%+ of users want the same thing | We pick it. No setting ships. |
| Option | Real, split preference with no correct answer | A setting ships, with a strong default. |
| Deleted | We're hedging because we couldn't decide | The feature goes back to design. |

The third bucket is the one that matters. A surprising number of settings exist because a team couldn't agree, so they shipped the disagreement. That's not flexibility. That's outsourcing your job to the user.

## Defaults are a promise

A default isn't just a pre-filled value. It's a statement: *if you never touch this, you're doing it right.* That promise has consequences:

> The default configuration is the only configuration most people will ever see. If it isn't excellent, your product isn't excellent for most people.

So we test the defaults hardest. Not the power-user paths: the untouched, out-of-the-box experience. The one nobody customizes.

## When an option earns its place

Some options genuinely deserve to exist. The ones that survive our checklist usually share three traits:

- **The preference is stable.** People who want it, want it every time. Appearance is the classic example.
- **Both sides are right.** Dense layouts and comfortable layouts are both correct, for different people, all the time.
- **The cost of the wrong guess is high.** If guessing wrong breaks someone's workflow, ask instead of guessing.

Everything else gets a decision, not a dropdown.

## The payoff

Fewer settings means faster onboarding, fewer support tickets, and a settings page you can actually find things on. But the real payoff is trust: a product that behaves well untouched feels *designed*, because it was.

Delete a setting this week. You almost certainly have one that's just a hedge.
