// finalize-release's release lookup and asset replacement
// ([#810](https://github.com/Omega-JS-Stack/omega/issues/810)).
//
// `repos.getReleaseByTag` cannot see a DRAFT: a draft carries no tag ref, so the
// lookup 404'd on every draft electron-builder had just created and each run made
// ANOTHER draft for the same version (two v0.0.1 drafts on the playground's
// releases repo, ids 384501732 and 384558163). The lookup lists instead, drafts
// included, and both call sites (the signed-Windows upload and the `--publish`
// flip) read through the one helper.
//
// The ids here are hard-coded on purpose: an expectation computed from the
// fixture would pass against any ordering rule at all.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { findRelease } = require('../../../commands/finalize-release.js');

// The releases repo as GitHub returns it: drafts and published releases across
// several tags, in the API's own order (newest created first is NOT guaranteed).
const RELEASES = [
  { id: 384000001, tag_name: 'v0.0.2', draft: false, created_at: '2026-09-06T10:00:00Z' },
  { id: 384501732, tag_name: 'v0.0.1', draft: true,  created_at: '2026-09-07T23:54:00Z' },
  { id: 383900007, tag_name: 'v0.0.1', draft: false, created_at: '2026-09-05T08:00:00Z' },
  { id: 384558163, tag_name: 'v0.0.1', draft: true,  created_at: '2026-09-08T01:31:00Z' },
];

// A fake octokit whose paginate answers with the fixture above.
function stubOctokit() {
  return {
    paginate: async () => RELEASES,
    rest: { repos: { listReleases: () => {} } },
  };
}

// Helper: stage a brand monorepo with one desktop target, so the seed-mode walk
// (config/omega.json5 at the root, the target under targets/) sees a real brand.
// Returns { brandRoot, targetDir }.
function stageBrand(config) {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-finalize-'));
  const targetDir = path.join(brandRoot, 'targets', 'desktop');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify(config));
  return { brandRoot, targetDir };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'finalize-release (#810): the release lookup sees drafts, and same-name assets are replaced',
  tests: [
    {
      name: 'findRelease: the NEWEST draft with the matching tag wins over an older draft and a published one',
      run: async (ctx) => {
        const release = await findRelease({
          octokit: stubOctokit(), owner: 'Omega-JS-Stack', repo: 'omega-playground-releases', tag: 'v0.0.1',
        });

        ctx.expect(release.id).toBe(384558163);
      },
    },
    {
      name: 'findRelease: a tag with only a PUBLISHED release resolves to it',
      run: async (ctx) => {
        const release = await findRelease({
          octokit: stubOctokit(), owner: 'Omega-JS-Stack', repo: 'omega-playground-releases', tag: 'v0.0.2',
        });

        ctx.expect(release.id).toBe(384000001);
      },
    },
    {
      name: 'findRelease: no release for the tag is null, not a throw (the upload step creates the draft)',
      run: async (ctx) => {
        const release = await findRelease({
          octokit: stubOctokit(), owner: 'Omega-JS-Stack', repo: 'omega-playground-releases', tag: 'v9.9.9',
        });

        ctx.expect(release).toBe(null);
      },
    },
    {
      name: 'upload: every colliding asset, installer and feed alike, is deleted BEFORE its re-upload',
      run: async (ctx) => {
        const finalizeRelease = require(path.join(__dirname, '..', '..', '..', 'commands', 'finalize-release.js'));
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme' },
          repo: { providers: { github: { org: 'Acme-Org' } } },
          targets: { desktop: { releases: {} } },
        });
        fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'acme-desktop', version: '1.2.3' }));

        // The installer AND the auto-updater feed: the metadata loop uploads the
        // yml separately, so a fixture holding only the exe never reaches it.
        const signedDir = path.join(targetDir, 'signed');
        fs.mkdirSync(signedDir, { recursive: true });
        fs.writeFileSync(path.join(signedDir, 'Acme-Setup-1.2.3.exe'), 'signed-installer-bytes');
        fs.writeFileSync(path.join(signedDir, 'latest.yml'), 'version: 1.2.3\n');

        // ONE ordered log of both calls: a delete landing AFTER its upload would
        // remove the asset the run had just written, so the SEQUENCE is what is
        // under test, not the presence of a delete.
        const calls    = [];
        const uploadTo = [];
        const created  = [];
        const octokit = {
          paginate: async () => [
            { id: 384558163, tag_name: 'v1.2.3', draft: true, created_at: '2026-09-08T01:31:00Z' },
          ],
          rest: {
            repos: {
              listReleases: () => {},
              createRelease: async (args) => { created.push(args.tag_name); return { data: { id: 1 } }; },
              listReleaseAssets: async () => ({ data: [
                { id: 990001, name: 'Acme-Setup-1.2.3.exe' },
                { id: 990002, name: 'latest.yml' },
              ] }),
              deleteReleaseAsset: async (args) => calls.push(`delete:${args.asset_id}`),
              uploadReleaseAsset: async (args) => { calls.push(`upload:${args.name}`); uploadTo.push(args.release_id); },
            },
          },
        };

        const cwd = process.cwd();
        const token = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_fake_token_for_unit_test';
        process.chdir(targetDir);
        try {
          await finalizeRelease({ signedDir: 'signed', octokit });
        } finally {
          process.chdir(cwd);
          if (token !== undefined) process.env.GH_TOKEN = token; else delete process.env.GH_TOKEN;
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }

        // The draft was found, so nothing new was created, each colliding asset
        // went before the upload that replaced it, and both landed on that draft.
        ctx.expect(created).toEqual([]);
        ctx.expect(calls).toEqual([
          'delete:990001',
          'upload:Acme-Setup-1.2.3.exe',
          'delete:990002',
          'upload:latest.yml',
        ]);
        ctx.expect(uploadTo).toEqual([384558163, 384558163]);
      },
    },
  ],
});
