/**
 * Consumer-scan permalink extraction — the regex that decides whether a
 * consumer page suppresses a framework default at the same URL.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { permalinkOf, scanConsumerPages } = require('../src/consumer-scan.js');

module.exports = defineCases({
  type: 'group',
  description: 'consumer-scan',
  tests: [
    {
      name: 'permalinkOf: bare value',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /about\n---')).toBe('/about');
      },
    },

    {
      name: 'permalinkOf: trailing slash stripped',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /about/\n---')).toBe('/about');
      },
    },

    {
      name: 'permalinkOf: root permalink preserved',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /\n---')).toBe('/');
      },
    },

    {
      name: 'permalinkOf: double-quoted value',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: "/about/"\n---')).toBe('/about');
      },
    },

    {
      name: 'permalinkOf: single-quoted value',
      run: (ctx) => {
        ctx.expect(permalinkOf("---\npermalink: '/about/'\n---")).toBe('/about');
      },
    },

    {
      name: 'permalinkOf: spaced path inside quotes (cp198)',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: "/my page/"\n---')).toBe('/my page');
      },
    },

    {
      name: 'permalinkOf: Liquid-templated permalink (cp198)',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /{{ page.lang }}/about/\n---')).toBe('/{{ page.lang }}/about');
      },
    },

    {
      name: 'permalinkOf: paginated blog default',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /blog/page/:num/\n---')).toBe('/blog/page/:num');
      },
    },

    {
      name: 'permalinkOf: no permalink returns null',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\ntitle: Hello\n---')).toBe(null);
      },
    },

    {
      name: 'permalinkOf: empty frontmatter returns null',
      run: (ctx) => {
        ctx.expect(permalinkOf('')).toBe(null);
      },
    },

    {
      name: 'permalinkOf: body-text permalink mention never claims a URL (cp199)',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\ntitle: Docs\n---\nSet this in frontmatter:\n\npermalink: /terms/\n')).toBe(null);
      },
    },

    {
      name: 'permalinkOf: file without frontmatter returns null (cp199)',
      run: (ctx) => {
        ctx.expect(permalinkOf('# Readme\npermalink: /terms/\n')).toBe(null);
      },
    },

    {
      name: 'permalinkOf: trailing YAML comment stripped from unquoted value (cp199)',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: /about/ # legal page\n---')).toBe('/about');
      },
    },

    {
      name: 'permalinkOf: quoted value keeps its content when a comment follows (cp199)',
      run: (ctx) => {
        ctx.expect(permalinkOf('---\npermalink: "/my page/" # note\n---')).toBe('/my page');
      },
    },

    {
      name: 'permalinkOf: BOM before frontmatter tolerated (cp199)',
      run: (ctx) => {
        ctx.expect(permalinkOf('\uFEFF---\npermalink: /about\n---')).toBe('/about');
      },
    },

    // ---- The scan itself (#200 Lane B): one entry per page, so a collision can
    // name the FILES that claim a URL, not just the URL.

    {
      name: 'scanConsumerPages: one entry per permalinked page, recursively',
      run: (ctx) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-scan-')));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const write = (rel, contents) => {
          const abs = path.join(root, rel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, contents);
        };

        write('pages/about.md', '---\npermalink: /about/\n---\nabout');
        write('pages/company/team.html', '---\npermalink: /team\n---\nteam');
        write('pages/no-permalink.md', '---\ntitle: Draft\n---\ndraft');
        write('pages/notes.txt', 'permalink: /notes');

        ctx.expect(scanConsumerPages(root).map((page) => ({ file: path.relative(root, page.file), url: page.url })).sort((a, b) => a.file.localeCompare(b.file))).toEqual([
          { file: path.join('pages', 'about.md'), url: '/about' },
          { file: path.join('pages', 'company', 'team.html'), url: '/team' },
        ]);
      },
    },

    {
      name: 'scanConsumerPages: a missing pages dir scans to nothing',
      run: (ctx) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-scan-')));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        ctx.expect(scanConsumerPages(root)).toEqual([]);
      },
    },
  ],
});
