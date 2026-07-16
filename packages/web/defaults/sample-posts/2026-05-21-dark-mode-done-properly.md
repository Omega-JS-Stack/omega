---
layout: blueprint/blog/post
post:
  title: "Dark mode, done properly"
  description: "Inverting the colors is the easy part. The last 10% — images, shadows, and charcoal instead of blue — is where dark modes are won."
  id: 9000006
  image: false
  categories: ["Design"]
  tags: ["design", "engineering"]
---

Every product has dark mode now. Most of them have *inverted* mode — the same interface with the values flipped, squinting back at you. Getting from there to a dark mode that feels designed comes down to a handful of decisions that don't show up in screenshots.

## Charcoal, not navy

The most common tell of a rushed dark theme is the blue cast — grays that drift toward navy because they were derived from a blue-tinted palette. True neutrals read calmer and let your accent color actually *be* the color. If the background has a hue, the whole interface is wearing sunglasses.

## Shadows don't work in the dark

Light mode communicates elevation with shadows. In dark mode there's nothing for a shadow to fall on — so elevation flips to *luminance*: the closer a surface is, the slightly lighter it gets. Panels a step lighter than the page, popovers a step lighter than panels. Subtle, but it's the difference between layered and flat.

## Don't blind people with your images

A pure-white diagram on a charcoal page is a flashlight. The fix costs one line — dim images slightly in dark contexts and nobody's pupils file a complaint:

```css
[data-theme='dark'] img {
  filter: brightness(0.9);
}
```

## Respect the preference, then remember the choice

Follow the system preference by default; if someone overrides it, remember that — per device, forever. The failure mode to avoid is the flash of the wrong theme on load. Resolve the theme *before* first paint, or the correction is the first thing users see.

## The test

Open your product at night, side by side with the apps people actually live in — the ones with design teams sweating these details. If yours looks flipped rather than designed, the gap is almost always one of the four things above. All four are a weekend.
