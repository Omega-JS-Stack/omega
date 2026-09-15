// Build-layer test for gulp/tasks/publish.js
// ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// A `file:` @omega.js spec is a SANCTIONED shape, not a smell: a linked brand
// carries one in the local era, and the CI snapshot lane rewrites every
// framework to `file:../../omega_modules/<pkg>.tgz` before the runner
// installs. The publish task used to refuse any `file:` dependency outright
// ("Please remove local packages before publishing!"), which failed every
// dispatched extension deploy at the publish step after a green build.
//
// The store LISTING IDS are config now (#893): each browser's own id lives at
// targets.<name>.listings.<browser>.id, so the firefox lane addresses AMO with
// the manifest's gecko id. The publish writes NO config: the id is pinned into
// the brand config on the laptop, by the local scaffold.
//
// The task reads its project package.json from cwd at REQUIRE time, so the
// test stages a temp project, chdirs into it, and requires the task fresh,
// the same model as package-task.test.js.

const path = require('path');
const fs = require('fs');
const os = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'publish.js');

// Run `fn(task)` with cwd pinned to `dir` and the task module loaded fresh.
async function inProject(dir, fn) {
  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(dir);
    return await fn(require(TASK_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

// Stage the firefox artifact the publish signs: `web-ext sign` reads
// packaged/firefox/raw, and that manifest's gecko id is the guid AMO gives the
// listing (#893).
function stageGeckoManifest(dir, geckoId) {
  const raw = path.join(dir, 'packaged', 'firefox', 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Staged',
    version: '2.0.0',
    ...(geckoId ? { browser_specific_settings: { gecko: { id: geckoId } } } : {}),
  }));
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'publish task: the snapshot lane, the AMO listing metadata, and the release on the brand releases repo',
  tests: [
    {
      name: 'publish mode with a file: @omega.js dependency reaches the zip check, never a local-packages refusal (#872)',
      run: async (ctx) => {
        // The exact manifest the snapshot lane pushes: the framework as a
        // packed tarball under omega_modules/. No zips are staged, so the task
        // stops at its own "run build first" line, before any store call.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-task-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
          name: 'staged-ext',
          version: '3.1.4',
          dependencies: { '@omega.js/extension': 'file:../../omega_modules/omega.js-extension-0.50.0.tgz' },
        }));

        const previous = process.env.OMEGA_IS_PUBLISH;
        process.env.OMEGA_IS_PUBLISH = 'true';
        try {
          await inProject(tmp, async (task) => {
            const failure = await new Promise((resolve) => task(resolve));
            ctx.expect(failure).toBe(undefined);
          });
        } finally {
          if (previous === undefined) delete process.env.OMEGA_IS_PUBLISH;
          else process.env.OMEGA_IS_PUBLISH = previous;
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // #883: the GitHub release moved out of the scaffolded workflow's shell
    // and into the task: the repo is DERIVED (`<brand.id>-releases` under
    // repo.org), so no YAML types a repo name, and the tag is namespaced by
    // target so a second extension target publishes beside the first.
    {
      name: 'the release targets the brand releases repo, tagged per target (#883)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-release-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '3.1.4' }));
        for (const target of ['chrome', 'firefox']) {
          fs.mkdirSync(path.join(tmp, 'packaged', target), { recursive: true });
          fs.writeFileSync(path.join(tmp, 'packaged', target, 'extension.zip'), target);
        }

        const calls = [];
        await inProject(tmp, async (task) => {
          await task.publishToGitHubRelease({
            config: { brand: { id: 'acme' }, repo: { provider: 'github', org: 'Acme-Org' } },
            execFn: (file, args) => {
              calls.push({ file, args });
              // `release view` answers "no release yet", which is what makes
              // the create run: the create/upload argv is what this pins.
              if (args[1] === 'view') throw new Error('release not found (HTTP 404)');
              return '';
            },
          });
        });

        ctx.expect(calls.every((call) => call.file === 'gh')).toBe(true);

        const create = calls.find((call) => call.args[1] === 'create');
        ctx.expect(create.args.slice(0, 3)).toEqual(['release', 'create', 'extension-v3.1.4']);
        ctx.expect(create.args).toContain('--repo');
        ctx.expect(create.args[create.args.indexOf('--repo') + 1]).toBe('Acme-Org/acme-releases');

        const uploads = calls.filter((call) => call.args[1] === 'upload');
        ctx.expect(uploads.length).toBe(2);
        ctx.expect(uploads.map((call) => path.basename(call.args[3]))).toEqual([
          'extension-chrome.zip',
          'extension-firefox.zip',
        ]);
        ctx.expect(uploads.every((call) => call.args.includes('--clobber'))).toBe(true);
        ctx.expect(uploads.every((call) => call.args[call.args.indexOf('--repo') + 1] === 'Acme-Org/acme-releases')).toBe(true);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    // #884: AMO reuses the FIRST version's listing forever, so the summary,
    // the categories and the license are needed exactly once, on the publish
    // that CREATES the add-on. Without them a first `web-ext sign` comes back
    // "Bad Request" after a green build, and the listing has to be made by hand.
    {
      name: 'a FIRST publish signs with --amo-metadata carrying summary, categories and license (#884)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-amo-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '2.0.0', license: 'UNLICENSED' }));
        // The artifact being signed carries the gecko id, which is the guid AMO
        // gives the listing it creates (#893)
        stageGeckoManifest(tmp, 'extension@acme.example.com');
        fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), `{ brand: { id: 'staged' }, targets: { extension: { type: 'extension' } } }`);

        const env = { ...process.env };
        process.env.FIREFOX_API_KEY = 'user:key';
        process.env.FIREFOX_API_SECRET = 'secret';

        let command = '';
        try {
          await inProject(tmp, async (task) => {
            await task.publishToFirefox({
              config: { brand: { description: 'A demo extension for the OMEGA stack.' }, categories: ['privacy-security'] },
              executeFn: async (line) => { command = line; },
            });
          });
        } finally {
          process.env = env;
        }

        ctx.expect(command).toContain('npx web-ext sign');
        ctx.expect(command).toContain('--amo-metadata');
        // The listing is created UNDER the packaged manifest's gecko id: `web-ext
        // sign` reads it from --source-dir and has no --id option (run
        // 34738385576 failed on "Unknown argument: id", #893)
        ctx.expect(command).toContain(`${path.join('packaged', 'firefox', 'raw')}"`);
        ctx.expect(command).not.toContain('--id');

        const metadataPath = path.join(tmp, '.temp', 'amo-metadata.json');
        ctx.expect(command).toContain(metadataPath);

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        ctx.expect(metadata).toEqual({
          summary: { 'en-US': 'A demo extension for the OMEGA stack.' },
          categories: ['privacy-security'],
          version: { license: 'all-rights-reserved' },
        });

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'an UPDATE signs with no metadata and no --id: the packaged gecko id addresses the listing (#884)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-amo-update-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '2.0.1' }));

        const env = { ...process.env };
        process.env.FIREFOX_API_KEY = 'user:key';
        process.env.FIREFOX_API_SECRET = 'secret';

        let command = '';
        try {
          await inProject(tmp, async (task) => {
            await task.publishToFirefox({
              // A brand with no description at all: an update never composes
              // the metadata, so it can never fail on one either. The declared
              // listing id is what makes it an update (#893)
              config: { listings: { firefox: { id: 'extension@acme.com' } } },
              executeFn: async (line) => { command = line; },
            });
          });
        } finally {
          process.env = env;
        }

        ctx.expect(command).not.toContain('--id');
        ctx.expect(command).not.toContain('--amo-metadata');
        ctx.expect(fs.existsSync(path.join(tmp, '.temp', 'amo-metadata.json'))).toBe(false);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    // #893: a publish writes NO config, first or not. The publish runs on the
    // runner's throwaway checkout of the mirror, so a write there never reached
    // the brand tree and every deploy took the "Creating new add-on" path again.
    // The id is pinned on the laptop by the local scaffold (ensure-target.js),
    // which runs before the snapshot this publish rides.
    {
      name: 'a first firefox publish never writes the brand config (#893): the scaffold pinned the id on the laptop',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-nowrite-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '2.0.0' }));
        fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
        const source = `{\n  brand: { id: 'staged', name: 'Staged', description: 'A demo extension.', url: 'https://staged.example.com' },\n  targets: { extension: { type: 'extension' } },\n}\n`;
        fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), source);
        stageGeckoManifest(tmp, 'extension@staged.example.com');

        const env = { ...process.env };
        process.env.FIREFOX_API_KEY = 'user:key';
        process.env.FIREFOX_API_SECRET = 'secret';

        const lines = [];
        const log = console.log;
        console.log = (...args) => lines.push(args.join(' '));

        try {
          await inProject(tmp, async (task) => {
            await task.publishToFirefox({
              config: { brand: { description: 'A demo extension.' } },
              executeFn: async () => {},
            });
          });
        } finally {
          console.log = log;
          process.env = env;
        }

        ctx.expect(fs.readFileSync(path.join(tmp, 'config', 'omega.json5'), 'utf8')).toBe(source);
        ctx.expect(lines.some((line) => line.includes('= extension@'))).toBe(false);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'an UPDATE writes nothing back: the id is already the config\'s (#893)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-nowriteback-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '2.0.1' }));
        fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
        const source = `{\n  brand: { id: 'staged', name: 'Staged' },\n  targets: { extension: { type: 'extension', listings: { firefox: { id: 'extension@staged.example.com' } } } },\n}\n`;
        fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), source);
        stageGeckoManifest(tmp, 'extension@staged.example.com');

        const env = { ...process.env };
        process.env.FIREFOX_API_KEY = 'user:key';
        process.env.FIREFOX_API_SECRET = 'secret';

        try {
          await inProject(tmp, async (task) => {
            await task.publishToFirefox({
              config: { listings: { firefox: { id: 'extension@staged.example.com' } } },
              executeFn: async () => {},
            });
          });
        } finally {
          process.env = env;
        }

        ctx.expect(fs.readFileSync(path.join(tmp, 'config', 'omega.json5'), 'utf8')).toBe(source);

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    // The chrome and edge ids have no publish that can mint them: the store
    // assigns each when a human creates the listing, so the publish names the
    // config path to paste it into (the manage walk asks for it, #867).
    {
      name: 'chrome refuses with the CONFIG path when no listing id is declared (#893)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-chrome-id-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        const env = { ...process.env };
        process.env.CHROME_CLIENT_ID = 'client';
        process.env.CHROME_CLIENT_SECRET = 'secret';
        process.env.CHROME_REFRESH_TOKEN = 'refresh';

        let message = '';
        try {
          await inProject(tmp, async (task) => {
            await task.publishToChrome({ config: {}, executeFn: async () => {} })
              .catch((error) => { message = error.message; });
          });
        } finally {
          process.env = env;
        }

        ctx.expect(message).toContain('targets.extension.listings.chrome.id');
        ctx.expect(message).toContain('config/omega.json5');
        ctx.expect(message).not.toContain('CHROME_EXTENSION_ID');

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'edge refuses with the CONFIG path when no listing id is declared (#893)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-edge-id-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        const env = { ...process.env };
        process.env.EDGE_CLIENT_ID = 'client';
        process.env.EDGE_API_KEY = 'key';

        let message = '';
        try {
          await inProject(tmp, async (task) => {
            await task.publishToEdge({ config: {} }).catch((error) => { message = error.message; });
          });
        } finally {
          process.env = env;
        }

        ctx.expect(message).toContain('targets.extension.listings.edge.id');
        ctx.expect(message).toContain('config/omega.json5');
        ctx.expect(message).not.toContain('EDGE_PRODUCT_ID');

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    // #867: the DECLARATION is the switch. A store the brand kept is published
    // to, a store it dropped is never touched, a store with no listing id yet
    // gets the manual step (its zip is already on the release), and a declared
    // store with no developer key refuses before anything is uploaded, naming
    // the key and the walk that collects it.
    {
      name: 'the stores are the DECLARED ones, and a dropped one is never asked for credentials (#867)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-lanes-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        await inProject(tmp, async (task) => {
          const lanes = task.storeLanes({
            // Edge is dropped, so its two keys are never owed
            config: { platforms: { edge: false }, listings: { chrome: { id: 'chrome-item-id' } } },
            env: {
              CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'secret', CHROME_REFRESH_TOKEN: 'token',
              FIREFOX_API_KEY: 'key', FIREFOX_API_SECRET: 'secret',
            },
            target: 'extension',
          });

          ctx.expect(lanes.publish).toEqual(['chrome', 'firefox']);
          ctx.expect(lanes.manual).toEqual([]);
        });

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'a store with no listing id yet gets the manual step instead of a publish (#867)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-manual-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        await inProject(tmp, async (task) => {
          const lanes = task.storeLanes({
            // No listings at all: chrome and edge need an id a human creates,
            // firefox derives its own from the manifest gecko id (#893)
            config: {},
            env: {
              CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'secret', CHROME_REFRESH_TOKEN: 'token',
              FIREFOX_API_KEY: 'key', FIREFOX_API_SECRET: 'secret',
              EDGE_CLIENT_ID: 'id', EDGE_API_KEY: 'key',
            },
            target: 'extension',
          });

          ctx.expect(lanes.publish).toEqual(['firefox']);
          ctx.expect(lanes.manual.length).toBe(2);
          ctx.expect(lanes.manual[0]).toContain('Chrome Web Store has no listing id yet');
          ctx.expect(lanes.manual[0]).toContain('https://chrome.google.com/webstore/devconsole');
          // The zip is already on the release, so the manual step names it
          ctx.expect(lanes.manual[0]).toContain('extension-chrome.zip');
          ctx.expect(lanes.manual[0]).toContain('targets.extension.listings.chrome.id');
          // Edge ships the CHROME build, so its manual step names that zip too
          ctx.expect(lanes.manual[1]).toContain('Microsoft Edge Add-ons has no listing id yet');
          ctx.expect(lanes.manual[1]).toContain('extension-chrome.zip');
          ctx.expect(lanes.manual[1]).toContain('targets.extension.listings.edge.id');
        });

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    {
      name: 'a declared store with no developer key REFUSES, naming the key and the walk (#867)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-refusal-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        await inProject(tmp, async (task) => {
          let message = '';
          try {
            task.storeLanes({ config: { platforms: { chrome: false, firefox: false } }, env: {}, target: 'extension' });
          } catch (error) {
            message = error.message;
          }

          ctx.expect(message).toContain('EDGE_CLIENT_ID (required by platforms.edge.formats.store)');
          ctx.expect(message).toContain('EDGE_API_KEY');
          ctx.expect(message).toContain('omega manage --service publishing');
        });

        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },

    // C4/#883: the releases repo is the DURABLE channel and the one the brand
    // owns, so it is filled first. Running it after the store gate meant a
    // brand with no store credentials (the gate throws) or one failed store
    // upload published its zips nowhere at all.
    //
    // Read off the task source: the whole task is a gulp `series`, whose
    // throwing path crashes the process it runs in rather than rejecting, so
    // the ORDER of its three steps is pinned the way the web deploy pins its
    // push-then-Pages order.
    {
      name: 'the release upload runs after the zip check and BEFORE the store gate (#883)',
      run: (ctx) => {
        const source = fs.readFileSync(TASK_PATH, 'utf8');

        const zipCheck = source.indexOf('Extension zips not found for:');
        const release = source.indexOf('await publishToGitHubRelease();');
        // The store gate is storeLanes now (#867): it refuses on a missing
        // developer key and leaves a listing-less store to the manual step,
        // and both outcomes need the zips already on the release
        const storeGate = source.indexOf('const lanes = storeLanes(');

        ctx.expect(zipCheck > 0 && release > 0 && storeGate > 0).toBe(true);
        ctx.expect(zipCheck < release).toBe(true);
        ctx.expect(release < storeGate).toBe(true);

        // And exactly one call: the old site after the store results is gone,
        // so a run can never upload the same zips twice.
        ctx.expect(source.split('await publishToGitHubRelease();').length - 1).toBe(1);
      },
    },

    // Half an address uploads nowhere: the same repo a download button on the
    // site already points at is named in config, never guessed here.
    {
      name: 'a config that names no org refuses instead of publishing somewhere (#883)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-publish-noorg-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'staged-ext', version: '1.0.0' }));

        let message = '';
        await inProject(tmp, async (task) => {
          try {
            await task.publishToGitHubRelease({
              config: { brand: { id: 'acme' } },
              execFn: () => { throw new Error('gh must not run'); },
            });
          } catch (error) {
            message = error.message;
          }
        });

        ctx.expect(message).toContain('repo.org');
        fs.rmSync(tmp, { recursive: true, force: true });
      },
    },
  ],
});
