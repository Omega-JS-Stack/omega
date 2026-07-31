---
name: seo
description: Use before finishing any page work in a website app or in packages/web — or when the ask names SEO, meta title or description, canonical, open graph, structured data, one h1, sitemap, robots.txt, noindex, or search ranking.
user-invocable: true
---

# SEO (OMEGA web pages)

A page's search surface is almost entirely MECHANISM, not markup: the core head chrome emits the tags, page frontmatter supplies the values, and the sitemap is a default page. So the review is checking the inputs and checking that nothing was hand-written around the mechanism.

## Where the mechanism lives

- `packages/web/core/_includes/core/head.html` — emits `<title>`, `description`, `canonical`, the full `og:*` / `twitter:*` set, `robots`, favicons, feed links.
- `packages/web/core/_includes/core/foot.html` — emits every `application/ld+json` block. Read the gates there before adding a `schema` key (item 4 below).
- `packages/web/defaults/pages/sitemap.html` + `robots.html` — `/sitemap.xml` and `/robots.txt` as default pages a consumer can override.
- The frontmatter allow-list (`meta`, `schema`, `sitemap`, …) and the URL contract: `docs/web/index.md`. Translated pages: `docs/shared/translation.md`.

## The checklist

1. **`meta.title` and `meta.description` are present** in the page's frontmatter. An empty title falls back to `site.brand.name` — a page titled with the bare brand name is the tell. Keep the title around 60 characters and the description around 155 so neither is cut off in a result listing.
2. **Nothing hand-writes a meta tag.** No page or section emits `<title>`, `meta name="description"`, `link rel="canonical"`, or any `og:`/`twitter:` tag — head.html already did, and a second one is a duplicate. A page needs a value, not a tag.
3. **Exactly one h1 per page.** The page's head/heading section supplies it (`docs/web/sections.md` — the head cluster and its `h1_class` knob); a second heading section on the same composition is the usual cause of two.
4. **Structured data comes from foot.html, and each type has its OWN gate.** Never write a `ld+json` script into a page — check the gate instead, because a `schema` block on the wrong type is a silent no-op:
   - `schema.software_application.enabled` and `schema.faq_page.enabled` are the two frontmatter switches. The FAQ block also needs items, which it takes from `schema.faq_page.items`, else `faqs.items`, else `alternative.faqs.items` — enabled with no items anywhere renders nothing.
   - BlogPosting rides `resolved.post.id` and Person rides `resolved.member.id` — a collection document's own data, not a frontmatter switch. Nothing to set on a page.
   - Breadcrumbs, the Organization/brand block (the `ContactPoint` lives inside it), and the WebSite/SearchAction block are unconditional on every page — they read `site`, so a gap there is a config gap.
   - ContactPage renders on the URL: `page.url == "/contact"` only.
   - The Product renderer is DEAD — it gates on a `page-is-product` flag nothing in the framework assigns. Product markup needs that flag wired first; a `schema` key will not reach it.
5. **Indexability is deliberate.** `meta.index: false` emits `noindex`; `sitemap.include: false` drops the page from `/sitemap.xml`. If a page has either, it is on purpose; if a page that should be private has neither, that is the finding. `/admin/` and `/test/` are already excluded by both default pages.
6. **The social image resolves.** `meta.image`, else `brand.images.social`, else the brandmark. Dimensions default to 1200×630 (`meta.og_image_width`/`_height` override).
7. **Internal links use the URL contract** — flat and extensionless, no trailing slash (`/signin`, never `/signin/` or `/signin.html`) — and every one resolves to a real page or a default page's permalink.
8. **Translations are the translate pass's job.** hreflang alternates, `og:locale`, and the translated sitemap entries are produced from `dist/`; never hand-author an alternate.

## Verifying

Read the built output rather than trusting the template: `omega build` in the app, then check `dist/<page>.html` and `dist/sitemap.xml`. For a running dev server, inspect the live head through the `omega:browser` skill instead of restarting anything.
