/**
 * Blog pagination pages (/blog/page/2, /blog/page/3, …) run the same module as
 * /blog: the masthead search box is on every paginated page, so the search
 * wiring has to be there too. Page assets resolve by URL, and `blog/index`
 * never matches a three-segment URL — this wildcard entry is that match.
 */
export { default } from '../../index.js';
