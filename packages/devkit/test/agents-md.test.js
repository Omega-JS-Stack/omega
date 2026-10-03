/**
 * agents-md: the one builder of every project-root AGENTS.md, brand root or a
 * framework used alone. The Default section imports the installed manager's
 * AGENTS.md, the Custom section holds the project's notes and survives every
 * path, every older shape converges, and a brand target keeps none. Real
 * directories in an os.tmpdir() scratch, no mocks.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentsMd = require('../src/agents-md.js');
const { DEFAULT_MARKER, CUSTOM_MARKER, sectionMarkers } = require('../src/merge-line-files.js');

const { IMPORT_LINE, GUIDE_SUBPATH, RETIRED_SUBPATH, ensureAgentsMd, removeRetiredLink, resolveImportLine, retireAgentsMd, scaffoldAgentsMd } = agentsMd;
const EM_DASH = String.fromCharCode(0x2014);
const MD = sectionMarkers('AGENTS.md');

// The one project-root shape: the import under Default, the notes under Custom.
function shaped(notes = '', importLine = IMPORT_LINE) {
  return `${MD.defaultMarker}\n${importLine}\n\n${MD.customMarker}\n${notes}`;
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-agents-md-'));
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// The retired per-framework template's shape: a framework section above the
// Custom marker, its shipped boilerplate below it.
function oldTemplate(customBody) {
  return `${DEFAULT_MARKER}\n# OMEGA Backend consumer project\n\n## Framework\n\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here. Edits below this line are preserved across runs.\n${customBody}`;
}

// The defaults engine's result shape, the vocabulary scaffoldAgentsMd records into.
function engineResult() {
  return { written: [], merged: [], skipped: [], removed: [] };
}

function recordingLogger() {
  const lines = { log: [], warn: [] };
  return { lines, logger: { log: (m) => lines.log.push(m), warn: (m) => lines.warn.push(m), error() {} } };
}

module.exports = defineCases({
  type: 'group',
  description: 'agents-md',
  tests: [
    // ─── The import line and the scope walk ──────────────────────────────────────

    {
      name: 'agents-md: the import line is the scope path to the manager\'s AGENTS.md',
      run: (ctx) => {
        ctx.expect(IMPORT_LINE).toBe('@node_modules/@omega.js/manager/AGENTS.md');
      },
    },

    {
      name: 'agents-md: resolveImportLine walks up to a hoisted install and falls back to canonical',
      run: (ctx) => {
        const root = tmpdir();
        const brand = path.join(root, 'targets', 'my-brand');
        fs.mkdirSync(brand, { recursive: true });
        ctx.expect(resolveImportLine(brand), 'nothing installed: the canonical project-local path').toBe(IMPORT_LINE);

        fs.mkdirSync(path.join(root, 'node_modules', '@omega.js', 'manager'), { recursive: true });
        ctx.expect(resolveImportLine(brand), 'hoisted two levels up').toBe(`@../../${GUIDE_SUBPATH}`);

        fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js', 'manager'), { recursive: true });
        ctx.expect(resolveImportLine(brand), 'a project-local install wins').toBe(IMPORT_LINE);
      },
    },

    {
      name: 'agents-md: an @omega.js dir without the manager never wins the scope walk',
      run: (ctx) => {
        const root = tmpdir();
        fs.mkdirSync(path.join(root, 'node_modules', '@omega.js', 'manager'), { recursive: true });
        const targetDir = path.join(root, 'targets', 'website');
        fs.mkdirSync(path.join(targetDir, 'node_modules', '@omega.js', 'web'), { recursive: true });

        ctx.expect(resolveImportLine(targetDir)).toBe(`@../../${GUIDE_SUBPATH}`);
      },
    },

    // ─── The retired scope link ──────────────────────────────────────────────────

    {
      name: 'agents-md: the retired import line converges to the manager import, notes kept',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@${RETIRED_SUBPATH}\n\n# Notes survive\n`);

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('# Notes survive\n'));
      },
    },

    {
      name: 'agents-md: removeRetiredLink removes the old scope link once, dangling or not',
      run: (ctx) => {
        const brand = tmpdir();
        const scope = path.join(brand, 'node_modules', '@omega.js');
        fs.mkdirSync(path.join(scope, 'manager'), { recursive: true });
        const link = path.join(scope, 'AGENTS.md');
        fs.symlinkSync(path.join(brand, 'gone.md'), link);

        ctx.expect(removeRetiredLink(brand, { dryRun: true })).toBe('removed');
        ctx.expect(fs.lstatSync(link).isSymbolicLink(), 'a dry run removes nothing').toBeTruthy();

        ctx.expect(removeRetiredLink(brand)).toBe('removed');
        ctx.expect(fs.lstatSync(link, { throwIfNoEntry: false })).toBe(undefined);
        ctx.expect(removeRetiredLink(brand)).toBe('absent');
        ctx.expect(removeRetiredLink(tmpdir()), 'no scope at all').toBe('absent');
      },
    },

    // ─── ensureAgentsMd ──────────────────────────────────────────────────────────

    {
      name: 'agents-md: missing AGENTS.md is created: the import under Default, an empty Custom section, no heading',
      run: (ctx) => {
        const dir = tmpdir();
        ctx.expect(ensureAgentsMd(dir)).toBe('created');

        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped());
        ctx.expect(!read(dir, 'AGENTS.md').includes(EM_DASH), 'no em dash in the written AGENTS.md').toBeTruthy();

        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: a stale-depth import in the Default section is healed, the Custom section untouched',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), shaped('# Notes survive\n', `@../../${GUIDE_SUBPATH}`));

        ctx.expect(ensureAgentsMd(dir)).toBe('healed');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('# Notes survive\n'));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: the import-on-line-1 shape converges: the skeleton heading drops, every other line lands under Custom in order',
      run: (ctx) => {
        for (const heading of ['# OMEGA Playground: brand notes', '# acme-site: project notes']) {
          const dir = tmpdir();
          fs.writeFileSync(path.join(dir, 'AGENTS.md'), `@../../${GUIDE_SUBPATH}\n<!-- keep this -->\n\n${heading}\n\nOur deploy needs the VPN up.\n\n## Later\n`);

          ctx.expect(ensureAgentsMd(dir)).toBe('converged');
          ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('<!-- keep this -->\n\nOur deploy needs the VPN up.\n\n## Later\n'));
          ctx.expect(ensureAgentsMd(dir), 'a second run writes nothing').toBe('present');
        }
      },
    },

    {
      name: 'agents-md: a heading-only file converges to the fresh file',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${IMPORT_LINE}\n\n# The Daily Build: brand notes\n`);

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped());
      },
    },

    {
      name: 'agents-md: a hand-written file without the import converges, every line kept under Custom',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# My brand\n\nHand-written notes that must survive.\n');

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('# My brand\n\nHand-written notes that must survive.\n'));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: converging removes a stray mid-file copy of the import, no duplicates ever',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Notes\n\n${IMPORT_LINE}\n\nMore notes.\n`);

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        const content = read(dir, 'AGENTS.md');
        ctx.expect(content.split('\n').filter((line) => line.trim() === IMPORT_LINE).length).toBe(1);
        ctx.expect(content).toBe(shaped('# Notes\n\nMore notes.\n'));
      },
    },

    // ─── The retired per-framework template converges ────────────────────────────

    {
      name: 'agents-md: an old-template AGENTS.md converges: framework section gone, consumer notes kept under Custom',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('Our deploy needs the VPN up.\n'));

        ctx.expect(ensureAgentsMd(dir), 'a converged file is the one shape: the next run is a no-op').toBe('present');
      },
    },

    {
      name: 'agents-md: an old template carrying only its shipped boilerplate converges to the fresh file',
      run: (ctx) => {
        for (const custom of [oldTemplate(''), `${DEFAULT_MARKER}\nguidance\n\n${CUSTOM_MARKER}\n<!-- Add your project-specific notes below this line -->\n`]) {
          const dir = tmpdir();
          fs.writeFileSync(path.join(dir, 'AGENTS.md'), custom);

          ctx.expect(ensureAgentsMd(dir)).toBe('converged');
          ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped());
        }
      },
    },

    {
      name: 'agents-md: notes quoting the # markers converge once as plain notes, never as the retired template',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${IMPORT_LINE}\n\n# Acme: project notes\n\nThe old template split on:\n${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`);

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped(`The old template split on:\n${DEFAULT_MARKER}\n${CUSTOM_MARKER}\n`));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: notes quoting the markdown markers inline take the converge path and lose nothing',
      run: (ctx) => {
        const dir = tmpdir();
        const notes = `# Acme\n\nWe split on \`${MD.defaultMarker}\` and \`${MD.customMarker}\`.\n`;
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), notes);

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped(notes));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: a title above the Default marker of a marked file moves to the top of Custom',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Acme\n\n${shaped('Our deploy needs the VPN up.\n')}`);

        ctx.expect(ensureAgentsMd(dir)).toBe('healed');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('# Acme\n\nOur deploy needs the VPN up.\n'));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: a Custom section holding the import converges once, then is present',
      run: (ctx) => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate(`\n${IMPORT_LINE}\n\n# Acme: project notes\n\nOur deploy needs the VPN up.\n`));

        ctx.expect(ensureAgentsMd(dir)).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('Our deploy needs the VPN up.\n'));
        ctx.expect(ensureAgentsMd(dir)).toBe('present');
      },
    },

    {
      name: 'agents-md: a dry run reports the convergence and the heal, and writes nothing',
      run: (ctx) => {
        const dir = tmpdir();
        const content = oldTemplate('\nkeep me\n');
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);

        ctx.expect(ensureAgentsMd(dir, { dryRun: true })).toBe('converged');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(content);

        const stale = shaped('', `@../${GUIDE_SUBPATH}`);
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), stale);
        ctx.expect(ensureAgentsMd(dir, { dryRun: true })).toBe('healed');
        ctx.expect(read(dir, 'AGENTS.md')).toBe(stale);
      },
    },

    // ─── A brand target keeps none ───────────────────────────────────────────────

    {
      name: 'agents-md: retireAgentsMd removes a copy holding nothing the consumer wrote',
      run: (ctx) => {
        for (const content of [shaped(), `${IMPORT_LINE}\n\n# web: project notes\n`, oldTemplate('')]) {
          const dir = tmpdir();
          fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);
          ctx.expect(retireAgentsMd(dir)).toBe('removed');
          ctx.expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(false);
        }

        ctx.expect(retireAgentsMd(tmpdir())).toBe('absent');
      },
    },

    {
      name: 'agents-md: retireAgentsMd keeps a copy carrying consumer notes, any shape',
      run: (ctx) => {
        for (const content of [shaped('Our deploy needs the VPN up.\n'), oldTemplate('\nOur deploy needs the VPN up.\n'), `${IMPORT_LINE}\n\n# web: project notes\n\nOur deploy needs the VPN up.\n`, '# Hand-written\n']) {
          const dir = tmpdir();
          fs.writeFileSync(path.join(dir, 'AGENTS.md'), content);

          ctx.expect(retireAgentsMd(dir)).toBe('kept');
          ctx.expect(read(dir, 'AGENTS.md')).toBe(content);
        }
      },
    },

    // ─── The framework scaffold step ─────────────────────────────────────────────

    {
      name: 'agents-md: scaffoldAgentsMd writes a standalone project the builder\'s file and records it',
      run: (ctx) => {
        const dir = path.join(tmpdir(), 'acme-site');
        fs.mkdirSync(dir);
        const result = engineResult();
        const { lines, logger } = recordingLogger();

        scaffoldAgentsMd({ outputDir: dir, standalone: true, result, logger });
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped());
        ctx.expect(result.written).toEqual(['AGENTS.md']);
        ctx.expect(lines.log.some((m) => m.includes('AGENTS.md')), 'the write is logged').toBeTruthy();

        const again = engineResult();
        scaffoldAgentsMd({ outputDir: dir, standalone: true, result: again, logger });
        ctx.expect(again, 'a rerun writes nothing').toEqual({ written: [], merged: [], skipped: ['AGENTS.md'], removed: [] });
      },
    },

    {
      name: 'agents-md: scaffoldAgentsMd converges a standalone old template loudly',
      run: (ctx) => {
        const dir = path.join(tmpdir(), 'acme-site');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));
        const result = engineResult();
        const { lines, logger } = recordingLogger();

        scaffoldAgentsMd({ outputDir: dir, standalone: true, result, logger });
        ctx.expect(result.merged).toEqual(['AGENTS.md']);
        ctx.expect(lines.warn.some((m) => /Converged AGENTS\.md/.test(m)), 'the convergence warns').toBeTruthy();
        ctx.expect(read(dir, 'AGENTS.md')).toBe(shaped('Our deploy needs the VPN up.\n'));
      },
    },

    {
      name: 'agents-md: scaffoldAgentsMd keeps a brand target free of AGENTS.md, never destroying notes',
      run: (ctx) => {
        const dir = tmpdir();
        const result = engineResult();
        const { lines, logger } = recordingLogger();

        scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
        ctx.expect(fs.existsSync(path.join(dir, 'AGENTS.md')), 'a brand target never gets one').toBe(false);

        fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate(''));
        scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
        ctx.expect(result.removed).toEqual(['AGENTS.md']);
        ctx.expect(lines.warn.some((m) => /Retired AGENTS\.md/.test(m))).toBeTruthy();

        fs.writeFileSync(path.join(dir, 'AGENTS.md'), oldTemplate('\nOur deploy needs the VPN up.\n'));
        scaffoldAgentsMd({ outputDir: dir, standalone: false, result, logger });
        ctx.expect(read(dir, 'AGENTS.md')).toMatch(/VPN/);
        ctx.expect(lines.warn.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints').toBeTruthy();
        ctx.expect(!lines.warn.join('\n').includes(EM_DASH), 'no em dash in the messages').toBeTruthy();
      },
    },

    // ─── No CLAUDE.md: Claude Code reads AGENTS.md itself ────────────────────────

    {
      name: 'agents-md: the lib carries no CLAUDE.md pointer helper',
      run: (ctx) => {
        ctx.expect(Object.keys(agentsMd).filter((key) => /claude/i.test(key))).toEqual([]);
      },
    },
  ],
});
