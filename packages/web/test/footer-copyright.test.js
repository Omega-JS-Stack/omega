/**
 * The footer copyright line: a sub-brand credits the parent company from the
 * RESOLVED `company` section (#677: the loader fills name/url from the parent's
 * own config, the brand types only `company: { id }`), never a typed literal.
 * Three shapes: no parent (the plain line), a parent without a url (plain
 * text), a parent with one (a link). The year keeps coming from site.omega.date.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
const { buildWith, miniData } = require('./lib/build.js');

function copyrightLine(html) {
  const match = html.match(/class="?omega-footer__copyright"?[^>]*>([\s\S]*?)<\/span>/);
  expect(match, 'the footer renders a copyright span').toBeTruthy();
  return match[1].replace(/\s+/g, ' ').trim();
}

module.exports = defineCases({
  type: 'group',
  description: 'footer-copyright',
  tests: [
    {
      name: 'no parent company configured → the plain brand line stands',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'footer-copyright-none');
        const line = copyrightLine(pages.get('/'));

        ctx.expect(line.includes('MiniCo. All rights reserved.'), `plain line: ${line}`).toBeTruthy();
        ctx.expect(!line.includes(' by '), 'nothing to credit').toBeTruthy();
      },
    },

    {
      name: 'a resolved company with no url → the parent is credited as plain text',
      run: async (ctx) => {
        const pages = await buildWith(
          { ...miniData, company: { id: 'mini-holdings', name: 'Mini Holdings', url: null, images: {} } },
          {},
          'footer-copyright-text',
        );
        const line = copyrightLine(pages.get('/'));

        ctx.expect(line.includes('MiniCo by Mini Holdings. All rights reserved.'), `credited: ${line}`).toBeTruthy();
        ctx.expect(!line.includes('<a'), 'no url configured, so no link').toBeTruthy();
      },
    },

    {
      name: 'a resolved company name + url → the parent name links the parent site',
      run: async (ctx) => {
        const pages = await buildWith(
          {
            ...miniData,
            company: { id: 'mini-holdings', name: 'Mini Holdings', url: 'https://miniholdings.example.com', images: {} },
          },
          {},
          'footer-copyright-link',
        );
        const line = copyrightLine(pages.get('/'));

        ctx.expect(line.includes('MiniCo by <a href="https://miniholdings.example.com">Mini Holdings</a>. All rights reserved.'), `linked: ${line}`).toBeTruthy();
      },
    },

    {
      name: 'the base row carries the framework powered-by line',
      run: async (ctx) => {
        const pages = await buildWith(miniData, {}, 'footer-powered');
        const html = pages.get('/');
        const match = html.match(/class="omega-footer__powered"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/);

        ctx.expect(match, 'the footer renders a powered-by span').toBeTruthy();
        const line = match[1].replace(/\s+/g, ' ').trim();

        ctx.expect(line.includes('Powered by'), `powered line: ${line}`).toBeTruthy();
        ctx.expect(line.includes('<a href="https://omegajs.dev" target="_blank" rel="noopener">omegajs.dev</a>'), `linked framework site: ${line}`).toBeTruthy();
        ctx.expect(/data-omega-fa="solid\/bolt"><svg/.test(line), `bolt icon inlined: ${line}`).toBeTruthy();
      },
    },

    {
      name: '#320: a LICENSED build drops the attribution, and nothing else moves',
      run: async (ctx) => {
        const pages = await buildWith(
          miniData,
          { license: { status: 'licensed', payments: 'live', attribution: 'removed' } },
          'footer-powered-licensed',
        );
        const html = pages.get('/');

        ctx.expect(!/omega-footer__powered/.test(html), 'a licensed deploy ships no framework attribution').toBeTruthy();
        ctx.expect(!/omegajs\.dev/.test(html), 'no stray link either').toBeTruthy();
        ctx.expect(copyrightLine(html).includes('MiniCo. All rights reserved.'), "the brand's own copyright is untouched").toBeTruthy();
      },
    },

    {
      name: '#379: the bolt and attribution links take the brand primary in both themes',
      run: (ctx) => {
        const themes = path.join(__dirname, '..', 'themes');
        const classy = fs.readFileSync(path.join(themes, 'classy', 'css', 'layout', '_footer.scss'), 'utf8');
        const newsflash = fs.readFileSync(path.join(themes, 'newsflash', 'css', 'layout', '_general.scss'), 'utf8');

        const block = (sheet, selector) => {
          const match = sheet.match(new RegExp(`\\.${selector}\\s*\\{([\\s\\S]*?)\\n  \\}`));
          ctx.expect(match, `${selector} rule exists`).toBeTruthy();
          return match[1];
        };

        // Classy: accent bolt + accent links (copyright parent link included)
        const classyPowered = block(classy, 'omega-footer__powered');
        ctx.expect(/\.fa\s*\{[^}]*var\(--omega-accent\)/.test(classyPowered), 'classy bolt is accent').toBeTruthy();
        ctx.expect(/a\s*\{[^}]*var\(--omega-accent\)/.test(classyPowered), 'classy powered link is accent').toBeTruthy();
        const classyCopyright = block(classy, 'omega-footer__copyright');
        ctx.expect(/a\s*\{[^}]*var\(--omega-accent\)/.test(classyCopyright), 'classy parent-company link is accent').toBeTruthy();

        // Newsflash: its primary is volt
        const nfPowered = block(newsflash, 'omega-footer__powered');
        ctx.expect(/\.fa\s*\{[^}]*var\(--nf-volt\)/.test(nfPowered), 'newsflash bolt is volt').toBeTruthy();
        ctx.expect(/a\s*\{[^}]*var\(--nf-volt\)/.test(nfPowered), 'newsflash powered link is volt').toBeTruthy();
        const nfCopyright = block(newsflash, 'omega-footer__copyright');
        ctx.expect(/a\s*\{[^}]*var\(--nf-volt\)/.test(nfCopyright), 'newsflash parent-company link is volt').toBeTruthy();
      },
    },

    {
      name: 'a company that IS the brand adds no self-credit (the standalone resolution)',
      run: async (ctx) => {
        // A brand with no company resolves to its OWN name and url, which is what
        // lets every reader work with no fallback (#677).
        const pages = await buildWith(
          { ...miniData, company: { id: null, name: 'MiniCo', url: miniData.brand.url, images: {} } },
          {},
          'footer-copyright-self',
        );
        const line = copyrightLine(pages.get('/'));

        ctx.expect(line.includes('MiniCo. All rights reserved.'), `plain line: ${line}`).toBeTruthy();
        ctx.expect(!line.includes(' by '), 'never "MiniCo by MiniCo"').toBeTruthy();
      },
    },
  ],
});
