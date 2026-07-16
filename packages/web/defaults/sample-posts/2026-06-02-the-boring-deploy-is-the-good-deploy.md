---
layout: blueprint/blog/post
post:
  title: "The boring deploy is the good deploy"
  description: "If shipping to production raises your heart rate, the process is telling you something. Here's what it takes to make deploys a non-event."
  id: 9000007
  image: "https://images.unsplash.com/photo-1667372393119-3d4c48d07fc9?auto=format&fit=crop&w=1600&q=80"
  categories: ["Engineering"]
  tags: ["engineering", "deploys"]
---

There are two kinds of teams: the ones where a deploy is a ceremony — announced in the channel, watched like a rocket launch — and the ones where nobody remembers how many times they shipped on Tuesday. The second kind wins, and not because they're braver.

## Ceremony is a symptom

When deploys are scary, teams deploy less. When teams deploy less, each deploy carries more changes. More changes per deploy means more ways for something to break and a harder time finding what did. The fear creates the exact conditions that justify the fear. It's a flywheel, and it spins both directions.

## What boring takes

Boring is earned with three unglamorous investments:

- **One command.** If the runbook has more than one step, the runbook is where mistakes live. The whole path — build, verify, publish, purge — belongs behind a single verb.
- **A dry run that tells the truth.** The rehearsal has to exercise the real pipeline against the real targets, minus the final write. A dry run that mocks half the world only rehearses your mocks.
- **Rollback you've actually used.** An untested rollback is a wish. Roll back on purpose once a quarter, on a calm afternoon, so the muscle exists when the afternoon isn't calm.

## The test

Ask the newest person on the team to ship something small today. If the answer involves a checklist, a senior engineer, or the phrase "after the freeze," you don't have a deploy process — you have a ritual. Rituals are for weddings.

Make it boring. Boring compounds.
