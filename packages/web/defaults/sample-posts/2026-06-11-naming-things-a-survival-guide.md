---
layout: blueprint/blog/post
post:
  title: "Naming things: a survival guide"
  description: "The two hard problems in computer science are cache invalidation, naming things, and off-by-one errors. This post is about the middle one."
  id: 9000008
  image: "/assets/images/core/placeholder/photo-3.jpg"
  categories: ["Guides"]
  tags: ["guides", "engineering", "culture"]
---

Every codebase carries the fossil record of its naming decisions. `utils2.js`. `NewButtonFinal`. A function called `handleData` that neither handles nor, strictly speaking, data. None of these were written by fools. They were written by smart people at 6pm. Naming fails under pressure unless you have rules that don't require judgment.

## Name the thing, not the shape

`items`, `data`, `info`, `payload`: these describe what something *is made of*, not what it *means*. The reader already knows it's data; everything here is data. `overdueInvoices` costs four more keystrokes and saves the next person a trip to the call site.

## Verbs for functions, nouns for values

A function is a promise to do something, so name the promise. `sendReceipt` beats `receipt`. And when a function's honest name turns out to be `sendReceiptAndUpdateLedgerAndNotifySlack`, the name has done its real job: it told you the function needs to be three functions.

## The grep test

Before committing a name, ask: if I searched for this in six months, would I find it, and *only* it? Names that collide with language keywords, framework globals, or forty other identifiers fail silently. `map` is unfindable. `regionMap` isn't.

## Rename without asking permission

The most underused refactor is the rename. It needs no design review, breaks no behavior, and pays out every single time someone reads the code. If you understand a thing better than its name suggests, fixing the name is not cosmetic: it's transferring your understanding to everyone who comes after.

The goal was never perfect names. It's names that don't lie.
