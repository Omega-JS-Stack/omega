// Build-layer tests for commands/push-secrets.js — the composed source, value resolution,
// repo discovery. We don't hit GitHub in tests; the encrypt + push path is exercised via the
// Octokit-driven integration which would need real creds. These cover the offline logic.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const pushSecrets = require(path.join(__dirname, '..', '..', '..', 'commands', 'push-secrets.js'));

// A brand root (config/omega.json5) with a targets/desktop target under it.
function tmpBrand({ brandEnv, targetEnv } = {}) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{ brand: { id: "b" } }');
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const target = path.join(brand, 'targets', 'desktop');
  fs.mkdirSync(target, { recursive: true });
  if (targetEnv !== undefined) fs.writeFileSync(path.join(target, '.env'), targetEnv);

  return { brand, target };
}

// key → value of a collected entry list (values are fixture strings, never real secrets).
function valuesOf(entries) {
  return Object.fromEntries(entries.map((e) => [e.key, e.value]));
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'push-secrets — composed env source + value resolution',
  tests: [
    {
      name: 'assertBrandRepo: signing material goes to the brand\'s DECLARED repo, or nowhere (#627 review)',
      run: (ctx) => {
        // The declared repo is the only proof of where these certificates
        // belong — an inferred remote is a fork, a template clone or a vendored
        // target away from arming a stranger's Actions. Web and extension got
        // this guard first; desktop pushes the most dangerous payload of the three.
        pushSecrets.assertBrandRepo({ declared: 'acme/app', discovered: 'acme/app' });
        // Case is GitHub's, not ours.
        pushSecrets.assertBrandRepo({ declared: 'Acme/App', discovered: 'acme/app' });

        let undeclared = null;
        try {
          pushSecrets.assertBrandRepo({ declared: null, discovered: 'acme/app' });
        } catch (e) {
          undeclared = e;
        }
        ctx.expect(undeclared === null).toBe(false);
        ctx.expect(undeclared.message).toContain('names no GitHub repo in config (repo.providers.github)');

        let mismatch = null;
        try {
          pushSecrets.assertBrandRepo({ declared: 'acme/app', discovered: 'Omega-JS-Stack/omega' });
        } catch (e) {
          mismatch = e;
        }
        ctx.expect(mismatch === null).toBe(false);
        ctx.expect(mismatch.message).toContain('the git remote here is Omega-JS-Stack/omega');
        ctx.expect(mismatch.message).toContain("this brand's repo is acme/app");
      },
    },
    {
      name: 'collectEntries: the brand-root .env supplies the target — no target .env exists (#678)',
      run: (ctx) => {
        const { brand, target } = tmpBrand({
          brandEnv: [
            'GH_TOKEN=brand-token',
            'APPLE_TEAM_ID=BRANDTEAM',
            'STRIPE_SECRET_KEY=sk_live_backend_only',
            'GOOGLE_ANALYTICS_SECRET_DESKTOP=desktop-stream',
            'MY_CUSTOM_THING=custom',
            'OMEGA_FONTAWESOME_ROOT=/Users/dev/.omega/fontawesome',
            '',
          ].join('\n'),
        });

        try {
          ctx.expect(fs.existsSync(path.join(target, '.env'))).toBe(false);

          const entries = pushSecrets.collectEntries({ projectRoot: target });
          ctx.expect(valuesOf(entries)).toEqual({
            GH_TOKEN: 'brand-token',
            APPLE_TEAM_ID: 'BRANDTEAM',
            GOOGLE_ANALYTICS_SECRET: 'desktop-stream',
          });
          ctx.expect(entries.every((e) => e.source === 'brand')).toBe(true);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collectEntries: a target .env overrides the brand root per key (#678)',
      run: (ctx) => {
        const { brand, target } = tmpBrand({
          brandEnv: 'GH_TOKEN=brand-token\nAPPLE_TEAM_ID=BRANDTEAM\n',
          targetEnv: 'APPLE_TEAM_ID=TARGETTEAM\nCSC_KEY_PASSWORD=target-pass\n',
        });

        try {
          const entries = pushSecrets.collectEntries({ projectRoot: target });
          ctx.expect(valuesOf(entries)).toEqual({
            GH_TOKEN: 'brand-token',
            APPLE_TEAM_ID: 'TARGETTEAM',
            CSC_KEY_PASSWORD: 'target-pass',
          });

          const sources = Object.fromEntries(entries.map((e) => [e.key, e.source]));
          ctx.expect(sources.APPLE_TEAM_ID).toBe('target');
          ctx.expect(sources.GH_TOKEN).toBe('brand');
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collectEntries: --only narrows the composed set',
      run: (ctx) => {
        const { brand, target } = tmpBrand({ brandEnv: 'GH_TOKEN=brand-token\nAPPLE_TEAM_ID=BRANDTEAM\n' });

        try {
          const entries = pushSecrets.collectEntries({ projectRoot: target, only: 'GH_TOKEN' });
          ctx.expect(valuesOf(entries)).toEqual({ GH_TOKEN: 'brand-token' });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'resolveSecretValue: returns string as-is when value is not a path',
      run: async (ctx) => {
        const out = await pushSecrets.resolveSecretValue({ value: 'plain-string-value' }, '/tmp');
        ctx.expect(out).toBe('plain-string-value');
      },
    },
    {
      name: 'resolveSecretValue: empty value passes through',
      run: async (ctx) => {
        const out = await pushSecrets.resolveSecretValue({ value: '' }, '/tmp');
        ctx.expect(out).toBe('');
      },
    },
    {
      name: 'resolveSecretValue: returns base64 when value is an existing file path',
      run: async (ctx) => {
        // Create a temp .p12-like file.
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const filePath = path.join(tmpDir, 'cert.p12');
        const fileContent = Buffer.from('FAKE-CERT-BYTES');
        fs.writeFileSync(filePath, fileContent);

        try {
          const entry = { value: filePath };
          const out = await pushSecrets.resolveSecretValue(entry, '/tmp');
          ctx.expect(out).toBe(fileContent.toString('base64'));
          ctx.expect(entry.isFilePath).toBe(true);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'resolveSecretValue: path-like value but missing file → returns value as-is',
      run: async (ctx) => {
        const entry = { value: 'config/certs/does-not-exist.p12' };
        const out = await pushSecrets.resolveSecretValue(entry, '/tmp');
        ctx.expect(out).toBe('config/certs/does-not-exist.p12');
        ctx.expect(entry.isFilePath).toBeUndefined();
      },
    },
    {
      name: 'resolveSecretValue: relative path resolves against projectRoot',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const relName = 'config/certs/relative-cert.pem';
        const fullPath = path.join(tmpDir, relName);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from('REL'));

        try {
          const out = await pushSecrets.resolveSecretValue({ value: relName }, tmpDir);
          ctx.expect(out).toBe(Buffer.from('REL').toString('base64'));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'resolveSecretValue: falls back to the brand root when the target-relative path is missing',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const targetRoot = path.join(tmpDir, 'targets', 'desktop');
        fs.mkdirSync(targetRoot, { recursive: true });
        const relName = '.omega/secrets/brand-cert.p8';
        const fullPath = path.join(tmpDir, relName);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from('BRAND'));

        try {
          const out = await pushSecrets.resolveSecretValue({ value: relName }, targetRoot, tmpDir);
          ctx.expect(out).toBe(Buffer.from('BRAND').toString('base64'));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo: parses owner/repo from package.json repository.url',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        try {
          fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'fake',
            repository: { type: 'git', url: 'https://github.com/fixture-org/fixture-app' },
          }));
          const result = await pushSecrets.discoverRepo(tmpDir);
          ctx.expect(result.owner).toBe('fixture-org');
          ctx.expect(result.repo).toBe('fixture-app');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'discoverRepo: handles SSH-style git URL',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        try {
          fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'fake',
            repository: 'git@github.com:fixture-org/fixture-app.git',
          }));
          const result = await pushSecrets.discoverRepo(tmpDir);
          ctx.expect(result.owner).toBe('fixture-org');
          ctx.expect(result.repo).toBe('fixture-app');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ],
};
