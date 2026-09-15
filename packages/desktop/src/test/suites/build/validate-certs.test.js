// Build-layer tests for commands/validate-certs.js: what CSC_LINK is allowed to
// carry, the three validity rungs every surface shares
// ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)), and the rung an
// UNSET key is now ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)):
// the step READS the env the boot derived, and the `config/certs/` scan that
// used to stop a deploy the build would have signed fine is gone.
// The full validate flow (Keychain query, env vars) is exercised via real `npx omega deploy` prechecks.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execFileSync } = require('child_process');

const validateCerts = require(path.join(__dirname, '..', '..', '..', 'commands', 'validate-certs.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// A REAL signing certificate: a self-signed cert exported to a .p12 with a
// password, so the expiry read is the same openssl path a build takes.
function stageSigningCert({ days = 365 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-p12-'));
  const keyPath = path.join(dir, 'private.key');
  const certPath = path.join(dir, 'cert.cer');
  const p12Path = path.join(dir, 'dev-id.p12');
  const password = 'fixture-pass';

  execFileSync('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath,
    '-days', String(days), '-subj', '/CN=Developer ID Application: Fixture/C=US', '-outform', 'DER',
  ], { stdio: 'pipe' });
  execFileSync('openssl', [
    'pkcs12', '-export', '-legacy', '-inkey', keyPath, '-in', certPath, '-out', p12Path,
    '-passout', 'env:OMEGA_P12_PASSWORD',
  ], { stdio: 'pipe', env: { ...process.env, OMEGA_P12_PASSWORD: password } });

  return { dir, p12Path, password };
}

// Run one call with exactly these env vars set (undefined deletes the key), then
// put the environment back the way it was. An ASYNC call holds the window until
// it settles: checkMac awaits the Keychain query, and a restore that fired at
// the first await would hand the rest of the run this machine's real signing env.
function withEnv(vars, run) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  let result;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return result.finally(restore);
  }

  restore();
  return result;
}

// Run one call as if this leg were `platform`, then put the real value back.
// The mac rungs are darwin-only (#891), so a case about them has to say which
// leg it is rather than inherit the machine the suite happens to run on.
function withPlatform(platform, run) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });

  const restore = () => Object.defineProperty(process, 'platform', descriptor);

  let result;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return result.finally(restore);
  }

  restore();
  return result;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'validate-certs: the shapes CSC_LINK takes, the three validity rungs, and the unset-key rung',
  tests: [
    // BOTH mac credentials take three shapes
    // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): a path, an https
    // URL, or the file itself as inline base64. The build workflow ships two of them,
    // because only the mac job decodes the base64 secrets to files, and treating that
    // base64 as a path threw ENAMETOOLONG out of the precheck: first on CSC_LINK,
    // then, once that was fixed, on APPLE_API_KEY.
    // The cloud provider is read where sign-windows and the build read it,
    // `platforms.windows.signing.cloud.provider` (#872): the checker used to look
    // under `targets`, so a configured provider was always "not set" and its
    // env vars were never checked.
    {
      name: 'the Windows cloud provider is read from platforms.windows, and its env vars are checked',
      run: (ctx) => {
        const config = { platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } };
        const azure = { AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', AZURE_TRUSTED_SIGNING_ENDPOINT: 'e' };
        const none = Object.fromEntries(Object.keys(azure).map((key) => [key, undefined]));

        const configured = [];
        withEnv(azure, () => validateCerts.checkWindows(configured, 'cloud', config));
        ctx.expect(configured).toEqual([]);

        const bare = [];
        withEnv(none, () => validateCerts.checkWindows(bare, 'cloud', config));
        ctx.expect(bare.length).toBe(1);
        ctx.expect(bare[0].message).toContain('Missing cloud-signing env vars for azure');
      },
    },
    {
      name: 'CSC_LINK carrying an inline base64 cert is reported, not statted',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-csc-'));
        const inline = 'MIIKvwIBAzCCCn8GCSqGSIb3DQEHAaCCCnAEggpsMIIKaDCCBR8'.repeat(60);

        try {
          ctx.expect(validateCerts.describeCertRef(inline, tmpDir).kind).toBe('inline');

          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: 'hunter2' }, () => validateCerts.checkSigningCert(issues, inline, tmpDir));
          ctx.expect(issues).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'CSC_LINK carrying a URL is reported, not statted',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-csc-'));
        const url = 'https://certs.example.com/dev-id.p12';

        try {
          ctx.expect(validateCerts.describeCertRef(url, tmpDir).kind).toBe('url');

          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: 'hunter2' }, () => validateCerts.checkSigningCert(issues, url, tmpDir));
          ctx.expect(issues).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'CSC_LINK naming a missing file is still the error it always was',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-csc-'));

        try {
          const described = validateCerts.describeCertRef('config/certs/dev-id.p12', tmpDir);
          ctx.expect(described.kind).toBe('file');
          ctx.expect(described.exists).toBe(false);

          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: 'hunter2' }, () => validateCerts.checkSigningCert(issues, 'config/certs/dev-id.p12', tmpDir));
          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].severity).toBe('error');
          ctx.expect(issues[0].message).toContain('CSC_LINK points to a missing file');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      // Flipped by #891: a certificate nobody can open signs nothing, and the
      // run that discovered this shipped an unsigned app on a warning.
      name: 'a cert of any shape without CSC_KEY_PASSWORD is an ERROR',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-csc-'));
        const inline = 'MIIKvwIBAzCCCn8GCSqGSIb3DQEHAaCCCnAEggpsMIIKaDCCBR8'.repeat(60);

        try {
          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: undefined }, () => validateCerts.checkSigningCert(issues, inline, tmpDir));
          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].severity).toBe('error');
          ctx.expect(issues[0].message).toContain('CSC_KEY_PASSWORD');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    // ── The three validity rungs, one rule (#892) ───────────────────────────
    // The manager's certificates walk and this step read the SAME function and
    // apply the same window, so a cert is never "fine" in one and stale in the
    // other.
    {
      name: 'a real .p12 reports its expiry through the shared reader, and a healthy one raises nothing',
      run: (ctx) => {
        const { dir, p12Path, password } = stageSigningCert();

        try {
          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: password }, () => validateCerts.checkSigningCert(issues, p12Path, dir));
          ctx.expect(issues).toEqual([]);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'under 30 days WARNS, expired ERRORS, and a healthy date says nothing',
      run: (ctx) => {
        const days = (n) => ({ expiresAt: new Date(Date.now() + n * 86400000), daysLeft: n });

        ctx.expect(validateCerts.expiryRung('config/certs/dev-id.p12', days(200))).toBeNull();

        const soon = validateCerts.expiryRung('config/certs/dev-id.p12', days(10));
        ctx.expect(soon.severity).toBe('warn');
        ctx.expect(soon.message).toContain('expires in 10 day(s)');

        const expired = validateCerts.expiryRung('config/certs/dev-id.p12', days(-5));
        ctx.expect(expired.severity).toBe('error');
        ctx.expect(expired.message).toContain('EXPIRED on');
        ctx.expect(expired.message).toContain('omega manage --service certificates');

        // A profile with no date at all is not a finding
        ctx.expect(validateCerts.expiryRung('x.provisionprofile', null)).toBeNull();
      },
    },
    {
      name: 'a .p12 whose password does not open it is an error, not a silent pass',
      run: (ctx) => {
        const { dir, p12Path } = stageSigningCert();

        try {
          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: 'the-wrong-password' }, () => validateCerts.checkSigningCert(issues, p12Path, dir));
          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].severity).toBe('error');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'APPLE_API_KEY carrying an inline base64 key is reported, not statted',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-key-'));
        const inline = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tTUlHVEFnRUFNQk1HQnlxR1NNNDk'.repeat(50);

        try {
          ctx.expect(validateCerts.describeCertRef(inline, tmpDir).kind).toBe('inline');

          // An inline key has no filename, so the AuthKey_<id>.p8 cross-check has
          // nothing to read, while the id and issuer are still wanted.
          const issues = [];
          withEnv({ APPLE_API_KEY_ID: 'ABCDE12345', APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000' }, () => {
            validateCerts.checkNotarizationKey(issues, inline, tmpDir);
          });
          ctx.expect(issues).toEqual([]);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an inline APPLE_API_KEY still wants its key id and issuer',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-key-'));
        const inline = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tTUlHVEFnRUFNQk1HQnlxR1NNNDk'.repeat(50);

        try {
          const issues = [];
          withEnv({ APPLE_API_KEY_ID: undefined, APPLE_API_ISSUER: undefined }, () => {
            validateCerts.checkNotarizationKey(issues, inline, tmpDir);
          });

          ctx.expect(issues.length).toBe(2);
          ctx.expect(issues.map((issue) => issue.message).join(' ')).toContain('APPLE_API_KEY_ID is missing');
          ctx.expect(issues.map((issue) => issue.message).join(' ')).toContain('APPLE_API_ISSUER is missing');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'APPLE_API_KEY naming a missing file is still the error it always was',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-key-'));

        try {
          const issues = [];
          withEnv({ APPLE_API_KEY_ID: 'ABCDE12345', APPLE_API_ISSUER: 'x' }, () => {
            validateCerts.checkNotarizationKey(issues, 'config/certs/AuthKey.p8', tmpDir);
          });

          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].severity).toBe('error');
          ctx.expect(issues[0].message).toContain('APPLE_API_KEY points to a missing file');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a real AuthKey file still gets the filename/key-id cross-check',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-key-'));
        fs.mkdirSync(path.join(tmpDir, 'config', 'certs'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'config', 'certs', 'AuthKey_ABCDE12345.p8'), 'key');

        try {
          const issues = [];
          withEnv({ APPLE_API_KEY_ID: 'ZZZZZ99999', APPLE_API_ISSUER: 'x' }, () => {
            validateCerts.checkNotarizationKey(issues, 'config/certs/AuthKey_ABCDE12345.p8', tmpDir);
          });

          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].message).toContain('filename suggests key ID "ABCDE12345"');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      // #891: the boot derives CSC_LINK from the signing tree, so an unset key
      // here means the TREE has none. The line names where it looked and the
      // walk that fills it, and there is no `config/certs/` scan left to
      // contradict the build beside it.
      name: 'an unset CSC_LINK names the signing tree it looked in, never a certs-dir scan (#891)',
      run: async (ctx) => {
        const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-'));
        fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{ brand: { id: "b" } }');
        const target = path.join(brand, 'targets', 'desktop');
        fs.mkdirSync(target, { recursive: true });
        // A .p12 sitting in the OLD dispersed location: nothing may read it.
        fs.mkdirSync(path.join(target, 'config', 'certs'), { recursive: true });
        fs.writeFileSync(path.join(target, 'config', 'certs', 'developer-id-application.p12'), 'stale');

        const cwd = process.cwd();
        process.chdir(target);
        try {
          const issues = [];
          await withPlatform('darwin', () => withEnv({ CSC_LINK: undefined, APPLE_API_KEY: undefined, APPLE_API_KEY_ID: undefined, CSC_KEY_PASSWORD: undefined }, () => (
            validateCerts.checkMac(issues, { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } }, { execFn: () => Promise.resolve('') })
          )));

          const csc = issues.find((issue) => issue.message.includes('CSC_LINK'));
          ctx.expect(csc.message).toContain('.omega/certificates/apple/certificates/DEVELOPER_ID_APPLICATION_G2.p12');
          ctx.expect(csc.message).toContain('omega manage --service certificates');
          ctx.expect(issues.map((issue) => issue.message).join(' ')).not.toContain('Found .p12 in config/certs/');
        } finally {
          process.chdir(cwd);
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
    {
      // #891: electron-builder imports a CSC_LINK .p12 into its OWN temporary
      // keychain, so the login keychain answers nothing about that build. The
      // rung that read it anyway failed a runner whose file rungs had both just
      // passed, and it now belongs to the no-CSC_LINK path alone.
      name: 'a CSC_LINK cert never consults the Keychain, and an unset one still does (#891)',
      run: async (ctx) => {
        const { dir, p12Path, password } = stageSigningCert();
        const apple = { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } };
        // A machine with no Developer ID identity at all.
        const queried = [];
        const execFn = (command) => { queried.push(command); return Promise.resolve(''); };
        const cwd = process.cwd();
        process.chdir(dir);

        try {
          const withCert = [];
          await withPlatform('darwin', () => withEnv({ CSC_LINK: p12Path, CSC_KEY_PASSWORD: password, APPLE_API_KEY: p12Path, APPLE_API_KEY_ID: 'ABCDE12345', APPLE_API_ISSUER: 'x' }, () => (
            validateCerts.checkMac(withCert, apple, { execFn })
          )));

          ctx.expect(queried).toEqual([]);
          ctx.expect(withCert.filter((issue) => issue.severity === 'error')).toEqual([]);

          const without = [];
          await withPlatform('darwin', () => withEnv({ CSC_LINK: undefined, CSC_KEY_PASSWORD: undefined, APPLE_API_KEY: undefined, APPLE_API_KEY_ID: undefined }, () => (
            validateCerts.checkMac(without, apple, { execFn })
          )));

          const keychain = without.find((issue) => issue.message.includes('macOS Keychain'));
          ctx.expect(queried.length).toBe(1);
          ctx.expect(keychain.severity).toBe('error');
        } finally {
          process.chdir(cwd);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      // The gate the env schema already uses for the whole mac set: a brand
      // that declares no Apple signing owes no credential, so the finding is a
      // note rather than the rung that stops a deploy.
      name: 'the unsigned findings are ERRORS only when the config declares Apple signing (#891)',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-gate-'));
        const cwd = process.cwd();
        process.chdir(tmpDir);

        try {
          const declared = [];
          const undeclared = [];
          const execFn = () => Promise.resolve('');
          await withPlatform('darwin', () => withEnv({ CSC_LINK: undefined, APPLE_API_KEY: undefined, APPLE_API_KEY_ID: undefined }, async () => {
            await validateCerts.checkMac(declared, { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } }, { execFn });
            await validateCerts.checkMac(undeclared, {}, { execFn });
          }));

          const severityOf = (issues, key) => issues.find((issue) => issue.message.includes(key)).severity;
          ctx.expect(severityOf(declared, 'CSC_LINK')).toBe('error');
          ctx.expect(severityOf(declared, 'APPLE_API_KEY')).toBe('error');
          ctx.expect(severityOf(undeclared, 'CSC_LINK')).toBe('warn');
          ctx.expect(severityOf(undeclared, 'APPLE_API_KEY')).toBe('warn');
        } finally {
          process.chdir(cwd);
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      // #891: the linux and windows legs of the build workflow blank the mac
      // credentials on purpose (they cannot sign for mac), so running the mac
      // rungs there only prints two warnings about material nobody put on that
      // leg. The rungs belong to the leg that ships mac, and to no other.
      name: 'off darwin the mac rungs do not run at all (#891)',
      run: async (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-leg-'));
        const cwd = process.cwd();
        process.chdir(tmpDir);

        try {
          const queried = [];
          const execFn = (command) => { queried.push(command); return Promise.resolve(''); };

          for (const platform of ['linux', 'win32']) {
            const issues = [];
            await withPlatform(platform, () => withEnv({ CSC_LINK: undefined, APPLE_API_KEY: undefined, APPLE_API_KEY_ID: undefined, CSC_KEY_PASSWORD: undefined }, () => (
              validateCerts.checkMac(issues, { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } }, { execFn })
            )));

            ctx.expect(issues).toEqual([]);
          }

          ctx.expect(queried).toEqual([]);
        } finally {
          process.chdir(cwd);
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ],
});
