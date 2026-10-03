/**
 * emitIcons — the runtime icon-set emission (C4 cp112): the site output
 * gains assets/icons/<style>/<name>.svg from the resolved chain, best source
 * winning per file, curated core icons on top.
 *
 * createIconLoader — the BUILD-side read of the same chain (#619), so web's
 * build-time inlining and the browser's runtime fetch draw from one set.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { emitIcons, createIconLoader } = require('../src/icons.js');

function makeDir(base, rel, content) {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

module.exports = defineCases({
  type: 'group',
  description: 'icons',
  tests: [
    {
      name: 'emitIcons merges the chain best-first with core curation on top',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-emit-'));
        const pro = path.join(tmp, 'pro');
        const free = path.join(tmp, 'free');
        const core = path.join(tmp, 'core-icons');
        const out = path.join(tmp, 'out');

        makeDir(pro, 'solid/acorn.svg', '<svg>pro-acorn</svg>');
        makeDir(pro, 'solid/play.svg', '<svg>pro-play</svg>');
        makeDir(free, 'solid/play.svg', '<svg>free-play</svg>');
        makeDir(free, 'solid/circle-user.svg', '<svg>free-circle-user</svg>');
        makeDir(free, 'brands/github.svg', '<svg>free-github</svg>');
        makeDir(core, 'solid/rocket.svg', '<svg>core-rocket</svg>');
        makeDir(core, 'solid/play.svg', '<svg>core-play</svg>');

        const result = emitIcons({ outDir: out, svgsDirs: [pro, free], coreIconsDir: core });

        const read = (rel) => fs.readFileSync(path.join(out, 'assets', 'icons', rel), 'utf8');
        ctx.expect(read('solid/acorn.svg')).toBe('<svg>pro-acorn</svg>');        // pro-only survives
        ctx.expect(read('solid/play.svg')).toBe('<svg>core-play</svg>');         // core curation wins
        ctx.expect(read('solid/circle-user.svg')).toBe('<svg>free-circle-user</svg>'); // free floor fills in
        ctx.expect(read('brands/github.svg')).toBe('<svg>free-github</svg>');
        ctx.expect(read('solid/rocket.svg')).toBe('<svg>core-rocket</svg>');
        ctx.expect(result.files).toBe(5);
        ctx.expect(result.dest).toBe(path.join(out, 'assets', 'icons'));

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'emitIcons without an explicit chain uses the real resolved roots',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-emit-'));

        const result = emitIcons({ outDir: tmp });
        // The free floor alone guarantees the classic set is present.
        ctx.expect(fs.existsSync(path.join(result.dest, 'solid', 'play.svg'))).toBeTruthy();
        ctx.expect(fs.existsSync(path.join(result.dest, 'brands', 'github.svg'))).toBeTruthy();
        ctx.expect(result.files > 2000).toBeTruthy();

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: '#619: createIconLoader walks the chain, falls back to brands, and resolves aliases',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-load-'));
        const brand = path.join(tmp, 'brand');
        const free = path.join(tmp, 'free');

        makeDir(brand, 'solid/rocket.svg', '<svg>brand-rocket</svg>');
        makeDir(free, 'solid/rocket.svg', '<svg>free-rocket</svg>');
        makeDir(free, 'solid/bolt.svg', '<svg>free-bolt</svg>');
        makeDir(free, 'brands/github.svg', '<svg>free-github</svg>');
        makeDir(free, 'solid/magnifying-glass.svg', '<svg>free-magnifier</svg>');
        makeDir(tmp, 'icon-families.json', JSON.stringify({ 'magnifying-glass': { aliases: { names: ['search'] } } }));

        const load = createIconLoader({ svgsDirs: [brand, free], aliasFile: path.join(tmp, 'icon-families.json') });

        ctx.expect(load('rocket', 'solid'), 'the brand set outranks the floor').toBe('<svg>brand-rocket</svg>');
        ctx.expect(load('bolt', 'solid'), 'a name only the floor has resolves through the chain').toBe('<svg>free-bolt</svg>');
        ctx.expect(load('github', 'solid'), 'brands is the fallback dir for any weight').toBe('<svg>free-github</svg>');
        ctx.expect(load('search', 'solid'), 'an alias resolves to its canonical file').toBe('<svg>free-magnifier</svg>');
        ctx.expect(load('definitely-not-real', 'solid'), 'a miss is null — the caller decides what that means').toBe(null);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: '#619: createIconLoader strips the flag set\'s hardcoded root dimensions',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-load-'));
        makeDir(tmp, 'flags/us.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path d="M3 3"/></svg>');

        const load = createIconLoader({ svgsDirs: [tmp] });
        const flag = load('us', 'flags');

        ctx.expect(!flag.includes('"512"'), 'a 512px box would blow past the 1em icon sizing').toBeTruthy();
        ctx.expect(flag.includes('viewBox="0 0 512 512"'), 'the viewBox is not a dimension').toBeTruthy();

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
  ],
});
