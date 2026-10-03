/**
 * Deploy record (cp196): brand-root-resolved `<target>` under the `deploy`
 * section of .omega/state.json — written by deploy verbs, read by the
 * testing service to split never-deployed (nudge) from deployed-but-down
 * (error). state.json is the ONE sectioned record file (#479): a brand still
 * carrying the interim .omega/deploys.json (0.45.0) has it adopted once,
 * loudly, and a brand still carrying retired config-shaped keys beside its
 * records keeps them untouched.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordDeploy, readDeployRecord } = require('../src/deploy-record.js');
const { stripAnsi } = require('../src/attach-log-file.js');

function makeBrand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-record-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"brand"}');
  fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), '{"name":"brand-web"}');
  return root;
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
}

function readRecords(root) {
  return readState(root).deploy;
}

function writeState(root, state) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'state.json'), JSON.stringify(state));
}

function writeLegacyDeploys(root, records) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'deploys.json'), JSON.stringify(records));
}

// Capture the adoption notices a call prints; returns { result, lines }.
function capture(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(stripAnsi(args.map(String).join(' ')));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'deploy-record',
  tests: [
    {
      name: 'recordDeploy resolves to the brand root from a target dir; readDeployRecord sees it from anywhere',
      run: (ctx) => {
        const root = makeBrand();
        const targetDir = path.join(root, 'targets', 'web');

        ctx.expect(readDeployRecord({ dir: targetDir, target: 'web' })).toBe(null);

        const written = recordDeploy({ dir: targetDir, target: 'web', detail: { method: 'dispatch' } });
        ctx.expect(written.at, 'stamped').toBeTruthy();
        ctx.expect(written.method).toBe('dispatch');

        const records = readRecords(root);
        ctx.expect(records.web.method, 'record lands at the BRAND root, not the target').toBe('dispatch');

        ctx.expect(readDeployRecord({ dir: root, target: 'web' }).method).toBe('dispatch');
        ctx.expect(readDeployRecord({ dir: targetDir, target: 'backend' }), 'target-scoped').toBe(null);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'the record key is the target NAME, so sibling web targets never share a stamp (#886)',
      run: (ctx) => {
        const root = makeBrand();

        recordDeploy({ dir: root, target: 'web', detail: { method: 'dispatch' } });
        recordDeploy({ dir: root, target: 'admin', detail: { method: 'direct' } });

        ctx.expect(Object.keys(readRecords(root)).sort(), 'per-target records, distinct keys').toEqual(['admin', 'web']);

        ctx.expect(readDeployRecord({ dir: root, target: 'web' }).method).toBe('dispatch');
        ctx.expect(readDeployRecord({ dir: root, target: 'admin' }).method).toBe('direct');
        ctx.expect(readDeployRecord({ dir: root, target: 'cdn' }), 'a name the brand never deployed').toBe(null);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'recordDeploy preserves other targets',
      run: (ctx) => {
        const root = makeBrand();

        recordDeploy({ dir: root, target: 'backend' });
        recordDeploy({ dir: root, target: 'web' });

        const records = readRecords(root);
        ctx.expect(records.backend.at, 'other targets survive').toBeTruthy();
        ctx.expect(records.web.at).toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a foreign top-level state.json section survives a record write untouched (#479)',
      run: (ctx) => {
        const root = makeBrand();
        writeState(root, { install: { lastCheck: '2026-08-22T00:00:00.000Z', packages: ['web'] } });

        recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } });

        const state = readState(root);
        ctx.expect(state.install, 'other fact kinds are read-through, never rewritten').toEqual({ lastCheck: '2026-08-22T00:00:00.000Z', packages: ['web'] });
        ctx.expect(state.deploy.web.method, 'the deploy section is the only one this module writes').toBe('direct');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a standalone .omega/deploys.json is adopted into state.json, LOUDLY, and the old file goes (#479)',
      run: (ctx) => {
        const root = makeBrand();
        writeLegacyDeploys(root, { backend: { at: '2026-08-01T00:00:00.000Z', method: 'firebase' } });

        const { result, lines } = capture(() => readDeployRecord({ dir: root, target: 'backend' }));

        ctx.expect(result.method, 'the old record is not lost').toBe('firebase');
        ctx.expect(readRecords(root).backend, 'adopted whole, stamps intact').toEqual({ at: '2026-08-01T00:00:00.000Z', method: 'firebase' });
        ctx.expect(fs.existsSync(path.join(root, '.omega', 'deploys.json')), 'the old file is removed').toBe(false);

        ctx.expect(lines.length, 'ONE line, not a per-record chorus').toBe(1);
        ctx.expect(lines[0], 'the log-tag convention').toMatch(/\[@omega\.js\/devkit:deploy-record\]/);
        ctx.expect(lines[0], 'names what was adopted').toMatch(/deploys\.json/);
        ctx.expect(lines[0], 'names where it landed').toMatch(/state\.json/);
        ctx.expect(lines[0], 'says the old file went').toMatch(/removed/);

        const quiet = capture(() => recordDeploy({ dir: root, target: 'web' }));
        ctx.expect(quiet.lines, 'adoption is ONE-TIME — the next write is silent').toEqual([]);
        ctx.expect(readRecords(root).backend.method, 'the adopted record survives the next write').toBe('firebase');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'an EMPTY legacy deploys.json is cleaned up silently — no "Adopted 0" line (#479)',
      run: (ctx) => {
        const root = makeBrand();
        writeLegacyDeploys(root, {});

        const { lines } = capture(() => recordDeploy({ dir: root, target: 'web' }));

        ctx.expect(fs.existsSync(path.join(root, '.omega', 'deploys.json')), 'the empty husk still goes').toBe(false);
        ctx.expect(lines, 'nothing was adopted, so nothing is announced').toEqual([]);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'an unmigrated brand reads its records in place — retired keys untouched, nothing announced (#479)',
      run: (ctx) => {
        const root = makeBrand();
        writeState(root, {
          edge: { zoneId: 'zone-abc' },
          search: { propertyUrl: 'sc-domain:fixture-brand.test' },
          deploy: { backend: { at: '2026-07-17T00:00:00.000Z', method: 'firebase' } },
        });

        const { result, lines } = capture(() => readDeployRecord({ dir: root, target: 'backend' }));
        ctx.expect(result.method, 'the record is already home — read in place, no adoption').toBe('firebase');
        ctx.expect(lines, 'nothing moved, so nothing is announced').toEqual([]);

        const quiet = capture(() => recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } }));
        ctx.expect(quiet.lines, 'the write is silent too').toEqual([]);

        const state = readState(root);
        ctx.expect(state.deploy.backend.method, 'the existing record survives the write').toBe('firebase');
        ctx.expect(state.deploy.web.method).toBe('direct');
        ctx.expect(state.edge, 'retired content is the state-retirement migration\'s to move, never this module\'s').toEqual({ zoneId: 'zone-abc' });
        ctx.expect(state.search).toEqual({ propertyUrl: 'sc-domain:fixture-brand.test' });

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'a record already in state.json wins over the legacy file it adopts beside',
      run: (ctx) => {
        const root = makeBrand();
        recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } });
        writeLegacyDeploys(root, { web: { at: '2021-01-01T00:00:00.000Z', method: 'stale-file' }, desktop: { at: 'd' } });

        capture(() => {
          ctx.expect(readDeployRecord({ dir: root, target: 'web' }).method, 'the newer write is the record').toBe('direct');
        });

        ctx.expect(readDeployRecord({ dir: root, target: 'desktop' }).at, 'the rest of the old file is still adopted').toBe('d');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});
