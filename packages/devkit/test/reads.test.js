/**
 * reads.js — the captured-read helper (#200 Lane A). Reading through it IS
 * the watch registration, so this suite pins the RECORDING rules that make
 * that safe: directory granularity, a miss still arms, realpath outside the
 * consumer dir, and one scope per config build.
 *
 * Real files and real symlinks — the rules are filesystem facts, not shapes.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const reads = require('../src/reads.js');

// A fixture tree ({ 'relative/path': contents }) plus its realpath root.
function fixture(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-reads-')));
  t.after(() => {
    reads.closeScope();
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

const dirsOf = (targets) => targets.map((target) => target.dir).sort();

module.exports = defineCases({
  type: 'group',
  description: 'reads',
  tests: [
    {
      name: 'a readdir records the directory it read',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/nav.json': '{}' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        ctx.expect(reads.readdir(path.join(root, 'src', '_includes'))).toEqual(['nav.json']);
        ctx.expect(reads.recordedTargets()).toEqual([{ dir: path.join(root, 'src', '_includes'), kind: 'reset' }]);
      },
    },

    {
      name: 'a file read records its directory, never the file',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/deep/nav.json': '{ "label": "hi" }' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        ctx.expect(reads.read(path.join(root, 'src', '_includes', 'deep', 'nav.json'))).toBe('{ "label": "hi" }');
        ctx.expect(dirsOf(reads.recordedTargets())).toEqual([path.join(root, 'src', '_includes', 'deep')]);
      },
    },

    {
      name: 'a probe of a missing directory still arms the watch',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        ctx.expect(reads.dirExists(path.join(root, 'src', '_includes'))).toBe(false);
        ctx.expect(dirsOf(reads.recordedTargets()), 'a brand may author the dir mid-session — the reset must already be armed').toEqual([path.join(root, 'src', '_includes')]);
      },
    },

    {
      name: 'a file probe records the directory that would hold it',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_sections/toy/section.html': 'toy' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        ctx.expect(reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.html'))).toBe(true);
        ctx.expect(reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.json5'))).toBe(false);
        ctx.expect(dirsOf(reads.recordedTargets()), 'both probes are the same directory — one target').toEqual([path.join(root, 'src', '_sections', 'toy')]);
      },
    },

    {
      name: 'the union is deduped across reads and probes',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_layouts/a.html': 'a', 'src/_layouts/b.html': 'b' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.dirExists(path.join(root, 'src', '_layouts'));
        reads.readdir(path.join(root, 'src', '_layouts'));
        reads.read(path.join(root, 'src', '_layouts', 'a.html'));
        reads.read(path.join(root, 'src', '_layouts', 'b.html'));

        ctx.expect(dirsOf(reads.recordedTargets())).toEqual([path.join(root, 'src', '_layouts')]);
      },
    },

    {
      name: 'a path outside the consumer dir is recorded realpath-resolved',
      run: (ctx) => {
        const root = fixture(ctx, { 'packaged/core/_layouts/core.html': 'core', 'src/pages/index.html': 'page' });
        // The linked-brand shape: node_modules sits at the TARGET root, beside src/
        const linked = path.join(root, 'node_modules', '@omega.js', 'web');
        fs.mkdirSync(path.dirname(linked), { recursive: true });
        fs.symlinkSync(path.join(root, 'packaged'), linked);
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.readdir(path.join(linked, 'core', '_layouts'));

        ctx.expect(dirsOf(reads.recordedTargets()), 'Eleventy\'s watcher ignores node_modules wholesale — the resolved path sidesteps it (#134)').toEqual([path.join(root, 'packaged', 'core', '_layouts')]);
      },
    },

    {
      name: 'a MISSING path outside the consumer dir resolves through its nearest existing ancestor',
      run: (ctx) => {
        const root = fixture(ctx, { 'packaged/core/_layouts/core.html': 'core', 'src/pages/index.html': 'page' });
        const linked = path.join(root, 'node_modules', '@omega.js', 'web');
        fs.mkdirSync(path.dirname(linked), { recursive: true });
        fs.symlinkSync(path.join(root, 'packaged'), linked);
        reads.openScope({ consumerDir: path.join(root, 'src') });

        // A packaged dir this version does not ship yet (the next one might):
        // realpath has nothing to resolve, but the SYMLINK on the way to it is
        // exactly what Eleventy's watcher refuses to look through.
        reads.dirExists(path.join(linked, 'defaults', 'showcase'));

        ctx.expect(dirsOf(reads.recordedTargets()), 'the node_modules form would arm a path Eleventy ignores wholesale (#134)').toEqual([path.join(root, 'packaged', 'defaults', 'showcase')]);
      },
    },

    {
      name: 'a path inside the consumer dir is recorded as read',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/nav.json': '{}' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.readdir(path.join(root, 'src', '_includes'));

        ctx.expect(dirsOf(reads.recordedTargets())).toEqual([path.join(root, 'src', '_includes')]);
      },
    },

    {
      name: 'reads outside a scope record nothing',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/nav.json': '{}' });

        ctx.expect(reads.readdir(path.join(root, 'src', '_includes')), 'the boot phase and omega build read through the helper too — recording is what goes away').toEqual(['nav.json']);
        ctx.expect(reads.recordedTargets()).toEqual([]);
      },
    },

    {
      name: 'each scope records only its own reads',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/nav.json': '{}', 'src/_layouts/toy.html': 'toy' });

        reads.openScope({ consumerDir: path.join(root, 'src') });
        reads.readdir(path.join(root, 'src', '_includes'));
        const first = reads.closeScope();

        reads.openScope({ consumerDir: path.join(root, 'src') });
        reads.readdir(path.join(root, 'src', '_layouts'));
        const second = reads.closeScope();

        ctx.expect(dirsOf(first)).toEqual([path.join(root, 'src', '_includes')]);
        ctx.expect(dirsOf(second)).toEqual([path.join(root, 'src', '_layouts')]);
        ctx.expect(reads.recordedTargets(), 'a closed scope records nothing more').toEqual([]);
      },
    },

    {
      name: 'the armed handler receives the union when the scope closes',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_includes/nav.json': '{}' });
        const handled = [];

        reads.onNextScope((targets) => handled.push(targets));
        reads.openScope({ consumerDir: path.join(root, 'src') });
        reads.readdir(path.join(root, 'src', '_includes'));
        ctx.expect(handled, 'the union is only complete once the scope closes').toEqual([]);
        reads.closeScope();

        ctx.expect(handled.length).toBe(1);
        ctx.expect(dirsOf(handled[0])).toEqual([path.join(root, 'src', '_includes')]);

        // Armed for ONE scope: the next config build arms its own handler.
        reads.openScope({ consumerDir: path.join(root, 'src') });
        reads.readdir(path.join(root, 'src', '_includes'));
        reads.closeScope();
        ctx.expect(handled.length).toBe(1);
      },
    },

    // ---- Lane B: the rescan kind (#200)

    {
      name: 'a rescan capture records its dirs as rescan, never as reset',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page', 'src/_includes/nav.json': '{}' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.readdir(path.join(root, 'src', '_includes'));
        reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));

        ctx.expect(dirsOf(reads.recordedTargets()), 'a rescan dir on the reset lane would make every page edit rebuild the config').toEqual([path.join(root, 'src', '_includes')]);
        ctx.expect(dirsOf(reads.rescanTargets())).toEqual([path.join(root, 'src', 'pages')]);
      },
    },

    {
      name: 'a rescan target re-runs its own capture',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page' });
        reads.openScope({ consumerDir: path.join(root, 'src') });
        const seen = [];

        reads.rescan(() => seen.push(reads.readdir(path.join(root, 'src', 'pages')).length));
        ctx.expect(seen, 'the capture runs immediately — the recording is its side effect').toEqual([1]);

        fs.writeFileSync(path.join(root, 'src', 'pages', 'about.html'), 'page');
        reads.rescanTargets()[0].rerun();
        ctx.expect(seen, 'the re-run reads the CURRENT filesystem, not the captured one').toEqual([1, 2]);
      },
    },

    {
      name: 'reads outside the capture go back to the reset lane',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page', 'src/_layouts/toy.html': 'toy' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));
        reads.readdir(path.join(root, 'src', '_layouts'));

        ctx.expect(dirsOf(reads.recordedTargets())).toEqual([path.join(root, 'src', '_layouts')]);
        ctx.expect(dirsOf(reads.rescanTargets())).toEqual([path.join(root, 'src', 'pages')]);
      },
    },

    {
      name: 'a dir read by both lanes stays a reset target',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_layouts/toy.html': 'toy' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.rescan(() => reads.readdir(path.join(root, 'src', '_layouts')));
        reads.readdir(path.join(root, 'src', '_layouts'));

        ctx.expect(dirsOf(reads.recordedTargets()), 'the config itself depends on the dir — the reset is the stronger answer and covers the rescan too').toEqual([path.join(root, 'src', '_layouts')]);
        ctx.expect(reads.rescanTargets()).toEqual([]);
      },
    },

    {
      name: 'a rescan probe of a missing dir still arms',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.rescan(() => reads.dirExists(path.join(root, 'src', '_posts')));

        ctx.expect(dirsOf(reads.rescanTargets()), 'the first real post creates the dir — the rescan must already be armed').toEqual([path.join(root, 'src', '_posts')]);
      },
    },

    {
      name: 'the closing scope hands the rescan union to the armed handler too',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page', 'src/_layouts/toy.html': 'toy' });
        const handled = [];

        reads.onNextScope((targets, rescans) => handled.push({ targets, rescans }));
        reads.openScope({ consumerDir: path.join(root, 'src') });
        reads.readdir(path.join(root, 'src', '_layouts'));
        reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));
        reads.closeScope();

        ctx.expect(dirsOf(handled[0].targets)).toEqual([path.join(root, 'src', '_layouts')]);
        ctx.expect(dirsOf(handled[0].rescans)).toEqual([path.join(root, 'src', 'pages')]);
      },
    },

    // ---- Containment pruning (#200 Lane B)

    {
      name: 'a recorded dir covered by a recorded ancestor is pruned',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/_sections/toy/section.html': 'toy', 'src/_sections/deep/nested/section.html': 'deep' });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.dirExists(path.join(root, 'src', '_sections'));
        reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.html'));
        reads.fileExists(path.join(root, 'src', '_sections', 'deep', 'nested', 'section.html'));

        ctx.expect(dirsOf(reads.recordedTargets()), 'a watch target is recursive — a recorded descendant is the same target twice').toEqual([path.join(root, 'src', '_sections')]);
      },
    },

    {
      name: 'disjoint dirs are never pruned',
      run: (ctx) => {
        const root = fixture(ctx, {
          'src/_layouts/toy.html': 'toy',
          'src/_includes/nav.json': '{}',
          // The name-prefix trap: `_sections-extra` STARTS WITH `_sections`, so a
          // containment test that compares strings without the separator swallows a
          // sibling that shares a prefix — and that dir loses its watcher.
          'src/_sections/toy/section.html': 'toy',
          'src/_sections-extra/toy/section.html': 'extra',
        });
        reads.openScope({ consumerDir: path.join(root, 'src') });

        reads.readdir(path.join(root, 'src', '_layouts'));
        reads.readdir(path.join(root, 'src', '_includes'));
        reads.readdir(path.join(root, 'src', '_sections'));
        reads.readdir(path.join(root, 'src', '_sections-extra'));

        ctx.expect(dirsOf(reads.recordedTargets()), 'no dir contains another — pruning must not swallow a sibling, prefix or not').toEqual([
          path.join(root, 'src', '_includes'),
          path.join(root, 'src', '_layouts'),
          path.join(root, 'src', '_sections'),
          path.join(root, 'src', '_sections-extra'),
        ]);
      },
    },

    {
      name: 'pruning keeps every scan behind the surviving rescan target',
      run: (ctx) => {
        const root = fixture(ctx, { 'src/pages/index.html': 'page', 'src/pages/deep/about.html': 'page' });
        reads.openScope({ consumerDir: path.join(root, 'src') });
        const seen = [];

        reads.rescan(() => {
          reads.readdir(path.join(root, 'src', 'pages'));
          seen.push('outer');
        });
        reads.rescan(() => {
          reads.read(path.join(root, 'src', 'pages', 'deep', 'about.html'));
          seen.push('inner');
        });

        const targets = reads.rescanTargets();
        ctx.expect(dirsOf(targets), 'pages/deep is covered by pages').toEqual([path.join(root, 'src', 'pages')]);
        targets[0].rerun();
        ctx.expect(seen, 'the pruned dir\'s capture re-runs through the target that swallowed it').toEqual(['outer', 'inner', 'outer', 'inner']);
      },
    },
  ],
});
