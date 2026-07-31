---
layout: blueprint/blog/post
post:
  title: "Ship the docs with the diff"
  description: "Documentation written 'later' is documentation written never. The only docs that stay true are the ones that travel in the same commit as the change."
  id: 9000011
  image: "https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=1600&q=80"
  categories: ["Company"]
  tags: ["culture", "engineering", "docs"]
---

Every team agrees documentation matters, the way everyone agrees flossing matters. And every team has a wiki page titled "Getting Started" that starts you toward a build system retired eighteen months ago. The gap isn't discipline. It's *distance*: the further docs live from the change that invalidates them, the faster they rot.

## Later never comes

"I'll document it after launch" fails for a structural reason: after launch, the knowledge is stale in *your* head too. The moment you understand a change best is the moment you finish writing it. Docs written then take minutes; docs written next quarter take an afternoon of re-derivation and still come out wrong.

## Same diff or it didn't happen

The rule that actually works is mechanical, not motivational: a change that alters behavior ships its doc update **in the same commit**. New flag? The reference gains a row in the same diff. Removed feature? Its section dies in the same diff. Reviewers can hold the line without archaeology, because the truth and its description arrive together or not at all.

## Write for the person at 2am

The reader of internal docs is usually someone mid-incident, holding a pager and a search box. Optimize for them: lead with the command, not the philosophy. State what's true *now*, never the history of how it got that way. That story lives in commit messages, where it's already written and can never drift.

## One home per fact

Rot accelerates when the same fact lives in three places, because no diff can update all three. Give every fact one authoritative home and point everything else at it. A link can't go stale the way a copy can.

Docs aren't a genre of writing. They're a property of the diff.
