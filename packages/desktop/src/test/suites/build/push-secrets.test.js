// Build-layer tests for commands/push-secrets.js — the composed source, desktop's
// file → base64 value seam, and the publish itself.
//
// Offline by construction ([#682](https://github.com/Omega-JS-Stack/omega/issues/682)):
// the brand and target are temp dirs and the `gh`/`git` boundaries are injected,
// so the suite proves the real send shape without a repo, a credential or a
// network. What the shared publisher owns (the five loud skips, the declared-repo
// guard) is pinned once in @omega.js/devkit's target-secrets suite.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const pushSecrets = require(path.join(__dirname, '..', '..', '..', 'commands', 'push-secrets.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const quiet = { log() {}, warn() {}, error() {} };

// A brand root (config/omega.json5) with a targets/desktop target under it.
function tmpBrand({ brandEnv, targetEnv, repo } = {}) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), [
    '{',
    '  brand: { id: "b" },',
    ...(repo ? [`  repo: { providers: { github: { repo: '${repo}' } } },`] : []),
    '}',
  ].join('\n'));
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const target = path.join(brand, 'targets', 'desktop');
  fs.mkdirSync(target, { recursive: true });
  if (targetEnv !== undefined) fs.writeFileSync(path.join(target, '.env'), targetEnv);

  return { brand, target };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'push-secrets — composed env source + value resolution',
  tests: [
    {
      name: 'publishEnvSecrets: the schema set over the gh boundary, file-path secrets base64\'d, values on stdin',
      run: (ctx) => {
        const { brand, target } = tmpBrand({
          repo: 'acme/app',
          brandEnv: [
            'GH_TOKEN=brand-token',
            'APPLE_TEAM_ID=BRANDTEAM',
            'CSC_LINK=config/certs/dev-id.p12',
            'MY_CUSTOM_THING=custom',
            '',
          ].join('\n'),
        });
        // A brand-level certificate: named by a path the target root does not
        // hold, resolved from the brand root.
        const cert = path.join(brand, 'config', 'certs', 'dev-id.p12');
        fs.mkdirSync(path.dirname(cert), { recursive: true });
        fs.writeFileSync(cert, Buffer.from('FAKE-CERT-BYTES'));

        const gh = [];
        try {
          const result = pushSecrets.publishEnvSecrets({
            targetDir: target,
            logger: quiet,
            env: {},
            gitExecFn: () => 'git@github.com:acme/app.git\n',
            execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
          });

          ctx.expect(result.published).toEqual(['APPLE_TEAM_ID', 'CSC_LINK', 'GH_TOKEN']);
          ctx.expect(gh.map((c) => c.args.join(' '))).toEqual([
            'auth status',
            'secret set APPLE_TEAM_ID --repo acme/app',
            'secret set CSC_LINK --repo acme/app',
            'secret set GH_TOKEN --repo acme/app',
          ]);
          // The CERTIFICATE travels, never this laptop's path to it — and every
          // value goes on stdin, never in argv.
          ctx.expect(gh.slice(1).map((c) => c.input)).toEqual([
            'BRANDTEAM',
            Buffer.from('FAKE-CERT-BYTES').toString('base64'),
            'brand-token',
          ]);
          ctx.expect(gh.every((c) => c.file === 'gh')).toBe(true);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'publishEnvSecrets: a checkout that is not the brand\'s DECLARED repo skips loudly, never touching gh',
      run: (ctx) => {
        // The declared repo is the only proof of where these certificates
        // belong — an inferred remote is a fork, a template clone or a vendored
        // target away from arming a stranger's Actions. Desktop pushes the most
        // dangerous payload of the three binds.
        const { brand, target } = tmpBrand({ repo: 'acme/app', brandEnv: 'GH_TOKEN=brand-token\n' });
        const undeclared = tmpBrand({ brandEnv: 'GH_TOKEN=brand-token\n' });
        const said = [];
        const loud = { log: (m) => said.push(m), warn: (m) => said.push(m), error: (m) => said.push(m) };
        const noGh = () => { throw new Error('gh must not run'); };

        try {
          ctx.expect(pushSecrets.publishEnvSecrets({
            targetDir: target,
            logger: loud,
            env: {},
            execFn: noGh,
            gitExecFn: () => 'git@github.com:Omega-JS-Stack/omega.git\n',
          })).toEqual({ skipped: 'repo-mismatch' });

          ctx.expect(pushSecrets.publishEnvSecrets({
            targetDir: undeclared.target,
            logger: loud,
            env: {},
            execFn: noGh,
            gitExecFn: () => 'git@github.com:acme/app.git\n',
          })).toEqual({ skipped: 'no-declared-repo' });

          const heard = said.join('\n');
          ctx.expect(heard).toContain("this brand's repo is acme/app");
          ctx.expect(heard).toContain('names no GitHub repo in config');
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
          fs.rmSync(undeclared.brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collectEnvSecrets: the brand-root .env supplies the target — no target .env exists (#678)',
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

          ctx.expect(pushSecrets.collectEnvSecrets(target)).toEqual({
            APPLE_TEAM_ID: 'BRANDTEAM',
            GH_TOKEN: 'brand-token',
            GOOGLE_ANALYTICS_SECRET: 'desktop-stream',
          });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collectEnvSecrets: a target .env overrides the brand root per key (#678)',
      run: (ctx) => {
        const { brand, target } = tmpBrand({
          brandEnv: 'GH_TOKEN=brand-token\nAPPLE_TEAM_ID=BRANDTEAM\n',
          targetEnv: 'APPLE_TEAM_ID=TARGETTEAM\nCSC_KEY_PASSWORD=target-pass\n',
        });

        try {
          ctx.expect(pushSecrets.collectEnvSecrets(target)).toEqual({
            APPLE_TEAM_ID: 'TARGETTEAM',
            CSC_KEY_PASSWORD: 'target-pass',
            GH_TOKEN: 'brand-token',
          });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'collectEnvSecrets: --only narrows the composed set',
      run: (ctx) => {
        const { brand, target } = tmpBrand({ brandEnv: 'GH_TOKEN=brand-token\nAPPLE_TEAM_ID=BRANDTEAM\n' });

        try {
          ctx.expect(pushSecrets.collectEnvSecrets(target, { only: 'GH_TOKEN' })).toEqual({ GH_TOKEN: 'brand-token' });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'fileValueResolver: a plain string travels as itself, a path that names no file too',
      run: (ctx) => {
        const resolve = pushSecrets.fileValueResolver({ targetDir: '/tmp' });

        ctx.expect(resolve('plain-string-value', 'CSC_KEY_PASSWORD')).toBe('plain-string-value');
        // Path-shaped but nowhere on disk: it is a string, not a certificate.
        ctx.expect(resolve('config/certs/does-not-exist.p12', 'CSC_LINK')).toBe('config/certs/does-not-exist.p12');
      },
    },
    {
      name: 'fileValueResolver: an existing file travels as base64 — absolute, target-relative, or brand-relative',
      run: (ctx) => {
        const { brand, target } = tmpBrand();

        const absolute = path.join(brand, 'cert.p12');
        fs.writeFileSync(absolute, Buffer.from('ABS'));
        fs.mkdirSync(path.join(target, 'config', 'certs'), { recursive: true });
        fs.writeFileSync(path.join(target, 'config', 'certs', 'target.pem'), Buffer.from('TARGET'));
        fs.mkdirSync(path.join(brand, '.omega', 'secrets'), { recursive: true });
        fs.writeFileSync(path.join(brand, '.omega', 'secrets', 'brand-cert.p8'), Buffer.from('BRAND'));

        try {
          const resolve = pushSecrets.fileValueResolver({ targetDir: target });

          ctx.expect(resolve(absolute, 'CSC_LINK')).toBe(Buffer.from('ABS').toString('base64'));
          ctx.expect(resolve('config/certs/target.pem', 'CSC_LINK')).toBe(Buffer.from('TARGET').toString('base64'));
          // Brand-level material: the path is relative to the BRAND root, which
          // the target root does not hold.
          ctx.expect(resolve('.omega/secrets/brand-cert.p8', 'APPLE_API_KEY')).toBe(Buffer.from('BRAND').toString('base64'));
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
  ],
});
