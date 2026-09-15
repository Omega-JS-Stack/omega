// The NODE half of the fixture (the `default` export condition): what an
// ESM-only dependency does the moment it needs a require of its own, which is
// the shape that broke a packaged desktop app
// ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)). yargs-parser is
// the live case: `createRequire(import.meta.url)` with an `import.meta.url` of
// `undefined` throws ERR_INVALID_ARG_VALUE before a single line of app code
// runs.
//
// `viaRequire` requires a BUILT-IN rather than a file beside this one: a
// relative require resolves against the caller's own directory, which for a
// bundled copy is the bundle's, so a relative path would be testing where the
// output landed instead of whether the require works at all.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const flavor = 'node';
export const fileUrl = import.meta.url;
export const viaRequire = typeof require('node:path').join === 'function';
export const marker = 'ESM_ONLY_FIXTURE_NODE';
