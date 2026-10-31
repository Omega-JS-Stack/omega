// Unit tests for src/defaults-engine.js — the shared defaults-scaffolding engine.
//
// Each test builds a defaults tree + consumer dir under .temp/ programmatically
// (no committed fixtures — trees are tiny and per-test isolation matters), runs
// applyDefaults, and asserts on the consumer tree + the returned summary.

const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const { applyDefaults, mergeJson5Defaults } = require('../src/defaults-engine');
const { DEFAULT_MARKER, CUSTOM_MARKER } = require('../src/merge-line-files');

const TEMP = path.join(__dirname, '..', '.temp', `defaults-engine-${process.pid}`);
let caseIndex = 0;

// Fresh defaults/consumer pair per test.
function stage(defaultsFiles, consumerFiles) {
  const root = path.join(TEMP, `case-${caseIndex++}`);
  const defaultsDir = path.join(root, 'defaults');
  const outputDir = path.join(root, 'consumer');
  jetpack.dir(defaultsDir);
  jetpack.dir(outputDir);
  for (const [rel, contents] of Object.entries(defaultsFiles || {})) {
    jetpack.write(path.join(defaultsDir, rel), contents);
  }
  for (const [rel, contents] of Object.entries(consumerFiles || {})) {
    jetpack.write(path.join(outputDir, rel), contents);
  }
  return { defaultsDir, outputDir };
}

const quiet = { log: () => {}, warn: () => {}, error: () => {} };

// The consumer's config/omega.json5 is hand-edited: comments, blank lines and
// the trailing newline are theirs, so the merge writes only the differing keys
// through the comment-preserving editor instead of re-stringifying the file (#928).
const COMMENTED_CONSUMER = [
  '// Consumer notes: hand edited, keep these comments.',
  '{',
  '  theme: {',
  "    id: 'custom', // the brand's own theme",
  '  },',
  '',
  '  port: 1000,',
  '}',
].join('\n');

const COMMENTED_DEFAULTS = [
  '{',
  '  theme: {',
  "    id: 'classy',",
  '  },',
  '  port: 1000,',
  '  fresh: true,',
  '}',
  '',
].join('\n');

const COMMENTED_MERGED = [
  '// Consumer notes: hand edited, keep these comments.',
  '{',
  '  theme: {',
  "    id: 'custom', // the brand's own theme",
  '  },',
  '',
  '  port: 1000,',
  '  fresh: true,',
  '}',
  '',
].join('\n');

// A prior generation's generated CLAUDE.md: the framework's own marker grammar,
// content that no current template renders, and a Custom section carrying the
// old template's boilerplate plus lines the merge migrated out of Default.
const LEGACY_GENERATED_DOC = [
  DEFAULT_MARKER,
  '# OMEGA Backend (@omega.js/backend) — consumer project',
  '',
  '## Framework',
  '',
  'This project consumes **OMEGA Backend** (@omega.js/backend).',
  '',
  CUSTOM_MARKER,
  '- **`node_modules/backend-manager/CLAUDE.md`** — full framework reference',
  '',
  '## Project-specific notes',
  '',
  'Add anything specific to THIS project here. Edits below this line are preserved across `npx omega setup` runs.',
  '',
].join('\n');

module.exports = defineCases({
  type: 'group',
  description: 'defaults-engine',
  tests: [
    {
      name: 'throws without defaultsDir/outputDir',
      run: (ctx) => {
        ctx.expect(() => applyDefaults({})).toThrow(/defaultsDir and outputDir are required/);
      },
    },

    {
      name: 'fresh scaffold: copies files, strips `_.`, skips archive dirs and .DS_Store, .gitkeep creates dir only',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'README.md': 'readme',
          '_.gitignore': 'node_modules/',
          '_.env': `${DEFAULT_MARKER}\nKEY=""\n${CUSTOM_MARKER}\n`,
          '_mas/reference.plist': 'archive material',
          'src/.DS_Store': 'junk',
          'src/assets/.gitkeep': '',
          'test/_init.js': 'module.exports = {};',
        }, {});

        const result = applyDefaults({ defaultsDir, outputDir, logger: quiet });

        ctx.expect(jetpack.read(path.join(outputDir, 'README.md'))).toBe('readme');
        ctx.expect(jetpack.read(path.join(outputDir, '.gitignore'))).toBe('node_modules/');
        ctx.expect(jetpack.exists(path.join(outputDir, '.env'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(outputDir, '_mas'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(outputDir, 'src', '.DS_Store'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(outputDir, 'src', 'assets'))).toBe('dir');
        ctx.expect(jetpack.exists(path.join(outputDir, 'src', 'assets', '.gitkeep'))).toBe(false);
        // `_`-prefixed FILENAMES are not archives — they ship.
        ctx.expect(jetpack.read(path.join(outputDir, 'test', '_init.js'))).toBe('module.exports = {};');
        ctx.expect(result.merged.length).toBe(0);
      },
    },

    {
      name: 'overwrite rules: default overwrites, `overwrite: false` preserves the consumer file',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'always.txt': 'framework',
          'docs/page.md': 'framework',
        }, {
          'always.txt': 'consumer',
          'docs/page.md': 'consumer',
        });

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { '**/*.md': { overwrite: false } },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'always.txt'))).toBe('framework');
        ctx.expect(jetpack.read(path.join(outputDir, 'docs', 'page.md'))).toBe('consumer');
      },
    },

    {
      name: 'skip and overwrite accept functions receiving the item',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'pages/a.html': 'a',
          'pages/b.html': 'b',
        }, {});

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'pages/**/*': { skip: (item) => item.name === 'b.html' } },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'pages', 'a.html'))).toBe('a');
        ctx.expect(jetpack.exists(path.join(outputDir, 'pages', 'b.html'))).toBe(false);
      },
    },

    {
      name: 'name and path rules rewrite the destination',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({ 'tpl/file.txt': 'x' }, {});

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: {
            'tpl/file.txt': {
              name: (item) => item.name.replace('file', 'renamed'),
              path: () => 'moved',
            },
          },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'moved', 'renamed.txt'))).toBe('x');
      },
    },

    {
      name: 'template rule renders {{ key.path }}; unknown keys (GitHub ${{ }}) survive',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          '.nvmrc': 'v{{ versions.node }}',
          'wf.yml': 'node: {{ versions.node }}\ntoken: ${{ secrets.GH_TOKEN }}',
        }, {});

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { '{.nvmrc,wf.yml}': { template: { versions: { node: '22' } } } },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, '.nvmrc'))).toBe('v22');
        ctx.expect(jetpack.read(path.join(outputDir, 'wf.yml'))).toBe('node: 22\ntoken: ${{ secrets.GH_TOKEN }}');
      },
    },

    {
      name: 'mergeLines rule: consumer custom values survive, new framework keys arrive, a retired line leaves',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          '_.env': `${DEFAULT_MARKER}\nGH_TOKEN=""\nNEW_KEY=""\n${CUSTOM_MARKER}\n`,
          '_.gitignore': `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/*\n${CUSTOM_MARKER}\n`,
        }, {
          '.env': `${DEFAULT_MARKER}\nGH_TOKEN="mine"\n${CUSTOM_MARKER}\nCUSTOM="kept"\n`,
          '.gitignore': `${DEFAULT_MARKER}\nnode_modules/\nconfig/certs/\n${CUSTOM_MARKER}\nmy-secret-dir/\n`,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { '{_.env,_.gitignore}': { mergeLines: true } },
          logger: quiet,
        });

        const env = jetpack.read(path.join(outputDir, '.env'));
        ctx.expect(env).toMatch(/GH_TOKEN="mine"/);
        ctx.expect(env).toMatch(/NEW_KEY=""/);
        ctx.expect(env).toMatch(/CUSTOM="kept"/);

        // The framework block is fully managed (#926): a line the new block no longer
        // carries leaves the consumer instead of moving under the Custom marker.
        const gitignore = jetpack.read(path.join(outputDir, '.gitignore'));
        ctx.expect(gitignore).not.toMatch(/^config\/certs\/$/m);
        ctx.expect(gitignore).toMatch(/^config\/certs\/\*$/m);
        ctx.expect(gitignore).toMatch(/my-secret-dir\//);

        ctx.expect(result.merged.slice().sort()).toEqual(['.env', '.gitignore']);
      },
    },

    {
      name: 'merge rule (JSON5): consumer values + consumer-only keys survive, `default` sentinel replaced',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'config/app.json5': JSON5.stringify({ theme: { id: 'classy' }, port: 1000, fresh: true }, null, 2),
        }, {
          'config/app.json5': JSON5.stringify({
            theme: { id: 'custom', retiredSentinel: 'default', retiredValue: 'keep-me' },
            port: 'default',
            consumerOnly: { nested: 1 },
            retiredSentinel: 'default',
          }, null, 2),
        });

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'config/app.json5': { merge: true } },
          logger: quiet,
        });

        const merged = JSON5.parse(jetpack.read(path.join(outputDir, 'config', 'app.json5')));
        ctx.expect(merged.theme.id).toBe('custom');
        ctx.expect(merged.port).toBe(1000);
        ctx.expect(merged.fresh).toBe(true);
        ctx.expect(merged.consumerOnly).toEqual({ nested: 1 });

        // A key the framework no longer declares whose value is the `default` sentinel
        // is the framework's own unset marker, so it drops at every level (#926); a key
        // holding a real value is the consumer's and stays.
        ctx.expect('retiredSentinel' in merged).toBe(false);
        ctx.expect('retiredSentinel' in merged.theme).toBe(false);
        ctx.expect(merged.theme.retiredValue).toBe('keep-me');
      },
    },

    {
      name: 'merge rule (JSON5): comments, blank lines and formatting survive, the file ends with one newline',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'config/app.json5': COMMENTED_DEFAULTS,
        }, {
          // No trailing newline: the merge adds the one the consumer's editor dropped.
          'config/app.json5': COMMENTED_CONSUMER,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'config/app.json5': { merge: true } },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'config', 'app.json5'))).toBe(COMMENTED_MERGED);
        ctx.expect(result.merged).toEqual([path.join('config', 'app.json5')]);
      },
    },

    {
      name: 'merge rule (JSON5): a rerun with nothing to change writes nothing',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'config/app.json5': COMMENTED_DEFAULTS,
        }, {
          'config/app.json5': COMMENTED_CONSUMER,
        });
        const config = {
          defaultsDir,
          outputDir,
          fileMap: { 'config/app.json5': { merge: true } },
          logger: quiet,
        };

        applyDefaults(config);
        const second = applyDefaults(config);

        ctx.expect(second.merged).toEqual([]);
        ctx.expect(second.skipped).toEqual([path.join('config', 'app.json5')]);
        ctx.expect(jetpack.read(path.join(outputDir, 'config', 'app.json5'))).toBe(COMMENTED_MERGED);
      },
    },

    {
      name: 'files subset (watch single-file mode) processes only the listed source',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({ 'a.txt': 'a', 'b.txt': 'b' }, {});

        applyDefaults({
          defaultsDir,
          outputDir,
          files: [path.join(defaultsDir, 'a.txt')],
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'a.txt'))).toBe('a');
        ctx.expect(jetpack.exists(path.join(outputDir, 'b.txt'))).toBe(false);
      },
    },

    {
      name: 'global transform hook runs on text files, never on binaries',
      run: (ctx) => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        const { defaultsDir, outputDir } = stage({ 'page.md': 'Hello [site.name]' }, {});
        jetpack.write(path.join(defaultsDir, 'img.png'), png);

        applyDefaults({
          defaultsDir,
          outputDir,
          transform: (contents) => contents.replace('[site.name]', 'Acme'),
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'page.md'))).toBe('Hello Acme');
        ctx.expect(jetpack.read(path.join(outputDir, 'img.png'), 'buffer')).toEqual(png);
      },
    },

    {
      name: 'idempotency: a second run writes and merges nothing',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'a.txt': 'a',
          // Blank line before the Custom marker matters: the merge protocol normalizes
          // to that shape, so a template without it gets one merge-write before stabilizing.
          '_.env': `${DEFAULT_MARKER}\nKEY=""\n\n${CUSTOM_MARKER}\n`,
          'config/app.json5': JSON5.stringify({ x: 1 }, null, 2),
        }, {});
        const config = {
          defaultsDir,
          outputDir,
          fileMap: {
            '_.env': { mergeLines: true },
            'config/app.json5': { merge: true },
          },
          logger: quiet,
        };

        applyDefaults(config);
        const second = applyDefaults(config);

        ctx.expect(second.written.length).toBe(0);
        ctx.expect(second.merged.length).toBe(0);
      },
    },

    {
      name: 'mergeJson5Defaults is exported for direct use',
      run: (ctx) => {
        ctx.expect(typeof mergeJson5Defaults).toBe('function');
      },
    },

    {
      name: 'template rule renders through the one token renderer: a number prints, an object prints as JSON',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({ 'wf.yml': 'v{{ v.n }} {{ v }}' }, {});

        applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'wf.yml': { template: { v: { n: 1 } } } },
          logger: quiet,
        });

        ctx.expect(jetpack.read(path.join(outputDir, 'wf.yml'))).toBe('v1 {"n":1}');
      },
    },

    {
      name: 'retire rule: never scaffolds the file when the consumer lacks it',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({ 'CLAUDE.md': 'framework doc' }, {});

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: quiet,
        });

        ctx.expect(jetpack.exists(path.join(outputDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(result.removed).toEqual([]);
        ctx.expect(result.skipped).toEqual(['CLAUDE.md']);
      },
    },

    {
      name: 'retire rule: deletes a marker-less copy identical to the rendered template, pruning emptied dirs',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'docs/README.md': 'Docs for v{{ versions.node }}',
        }, {
          'docs/README.md': 'Docs for v22',
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'docs/**/*': { retire: true, template: { versions: { node: '22' } } } },
          logger: quiet,
        });

        ctx.expect(result.removed).toEqual([path.join('docs', 'README.md')]);
        ctx.expect(jetpack.exists(path.join(outputDir, 'docs')), 'emptied docs/ dir should be pruned').toBe(false);
      },
    },

    {
      name: 'retire rule: a marker-less copy the consumer edited is kept, with a warning',
      run: (ctx) => {
        const warnings = [];
        const { defaultsDir, outputDir } = stage({
          'CHANGELOG.md': '# CHANGELOG\n',
        }, {
          'CHANGELOG.md': '# CHANGELOG\n\n## 1.0.0\n- consumer release notes\n',
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CHANGELOG.md': { retire: true } },
          logger: { ...quiet, warn: (m) => warnings.push(m) },
        });

        ctx.expect(result.removed).toEqual([]);
        ctx.expect(jetpack.read(path.join(outputDir, 'CHANGELOG.md'))).toMatch(/consumer release notes/);
        ctx.expect(warnings.some((m) => m.includes('consumer content')), 'should warn to move consumer content to the brand root').toBeTruthy();
      },
    },

    {
      name: 'retire rule: marker files are judged by their Custom section (pristine boilerplate or whitespace-only = framework-owned)',
      run: (ctx) => {
        const template = `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here.\n`;
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': template,
        }, {
          // Pristine boilerplate custom section — even with a STALE default section.
          'CLAUDE.md': `${DEFAULT_MARKER}\nold framework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here.\n`,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: quiet,
        });

        ctx.expect(result.removed).toEqual(['CLAUDE.md']);
        ctx.expect(jetpack.exists(path.join(outputDir, 'CLAUDE.md'))).toBe(false);

        // Whitespace-only custom section is framework-owned too.
        const ws = stage({ 'CLAUDE.md': template }, {
          'CLAUDE.md': `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\n\n  \n`,
        });
        const wsResult = applyDefaults({
          defaultsDir: ws.defaultsDir,
          outputDir: ws.outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: quiet,
        });
        ctx.expect(wsResult.removed).toEqual(['CLAUDE.md']);
      },
    },

    {
      name: 'retire rule: a marker file with real consumer notes is kept, with a warning',
      run: (ctx) => {
        const warnings = [];
        const template = `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here.\n`;
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': template,
        }, {
          'CLAUDE.md': `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nOur deploy needs the VPN up.\n`,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: { ...quiet, warn: (m) => warnings.push(m) },
        });

        ctx.expect(result.removed).toEqual([]);
        ctx.expect(jetpack.read(path.join(outputDir, 'CLAUDE.md'))).toMatch(/VPN/);
        ctx.expect(warnings.some((m) => m.includes('consumer content'))).toBeTruthy();
      },
    },

    {
      name: 'retire rule: a PRIOR-GENERATION marker file is swept even when the current template dropped the markers',
      run: (ctx) => {
        // #101: CLAUDE.md became the one-line `@AGENTS.md` pointer, so the rendered
        // template carries no markers — the legacy generated file must still be
        // recognized as the framework's own and retired, not kept as consumer content.
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': '@AGENTS.md\n',
        }, {
          'CLAUDE.md': LEGACY_GENERATED_DOC,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: quiet,
        });

        ctx.expect(result.removed).toEqual(['CLAUDE.md']);
        ctx.expect(jetpack.exists(path.join(outputDir, 'CLAUDE.md'))).toBe(false);
      },
    },

    {
      name: 'retire rule: a consumer-authored file with NO framework markers is kept against a marker-less template',
      run: (ctx) => {
        const warnings = [];
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': '@AGENTS.md\n',
        }, {
          'CLAUDE.md': '# Notes\n\nOur deploy needs the VPN up.\n',
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'CLAUDE.md': { retire: true } },
          logger: { ...quiet, warn: (m) => warnings.push(m) },
        });

        ctx.expect(result.removed).toEqual([]);
        ctx.expect(jetpack.read(path.join(outputDir, 'CLAUDE.md'))).toMatch(/VPN/);
        ctx.expect(warnings.some((m) => m.includes('consumer content'))).toBeTruthy();
      },
    },

    {
      name: 'overwrite:false heals a PRIOR-GENERATION marker file to the marker-less template',
      run: (ctx) => {
        // #101 twin gap: on the standalone upgrade path the retire rule never runs —
        // the legacy content-bearing CLAUDE.md sat under `overwrite: false` and
        // survived beside the new AGENTS.md. The framework owns it: heal it.
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': '@AGENTS.md\n',
        }, {
          'CLAUDE.md': LEGACY_GENERATED_DOC,
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { '**/*': { overwrite: false } },
          logger: quiet,
        });

        ctx.expect(result.written).toEqual(['CLAUDE.md']);
        ctx.expect(jetpack.read(path.join(outputDir, 'CLAUDE.md')).trim()).toBe('@AGENTS.md');
      },
    },

    {
      name: 'overwrite:false still preserves a consumer file with no framework markers',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'CLAUDE.md': '@AGENTS.md\n',
        }, {
          'CLAUDE.md': '# Notes\n\nOur deploy needs the VPN up.\n',
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { '**/*': { overwrite: false } },
          logger: quiet,
        });

        ctx.expect(result.skipped).toEqual(['CLAUDE.md']);
        ctx.expect(jetpack.read(path.join(outputDir, 'CLAUDE.md'))).toMatch(/VPN/);
      },
    },

    {
      name: 'retire rule: compares through the global transform (an untouched transformed copy is framework-owned)',
      run: (ctx) => {
        const { defaultsDir, outputDir } = stage({
          'docs/README.md': 'Docs for [site.name]',
        }, {
          'docs/README.md': 'Docs for Acme',
        });

        const result = applyDefaults({
          defaultsDir,
          outputDir,
          fileMap: { 'docs/**/*': { retire: true } },
          transform: (contents) => contents.replace('[site.name]', 'Acme'),
          logger: quiet,
        });

        ctx.expect(result.removed).toEqual([path.join('docs', 'README.md')]);
      },
    },
  ],
});
