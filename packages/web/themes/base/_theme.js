// Base ships structure, not look — and no behavior of its own. This file
// exists for the same reason `_theme.scss` does: so the chain always
// RESOLVES. `core/js/main.js` dynamically imports `__theme__/_theme.js`, and
// the alias walks the theme roots and falls back to the FIRST one when no
// layer ships the file — so a theme that carries no js (a tier-2 consumer
// theme, a tokens-only rung-1 fork) used to fail the bundle with an ENOENT on
// a path it never claimed to own ([#773](https://github.com/Omega-JS-Stack/omega/issues/773)).
// Base is the floor that catches it: every theme chain ends here, so the
// import always lands on a real module.
//
// A theme with behavior ships its own `_theme.js` and wins the walk ahead of
// this one; nothing here is meant to be extended.
export {};
