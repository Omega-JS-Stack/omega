// Build-layer tests for commands/validate-certs.js: provisioning profile parsing,
// and what CSC_LINK is allowed to carry.
// The full validate flow (Keychain query, env vars) is exercised via real `npx omega deploy` prechecks.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const validateCerts = require(path.join(__dirname, '..', '..', '..', 'commands', 'validate-certs.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// A minimal mock provisioning profile (CMS-wrapped XML plist payload).
function makeMockProvision({ appId, expirationDate }) {
  const appIdLine = appId
    ? `\n  <key>application-identifier</key>\n  <string>${appId}</string>`
    : '';
  const expLine = expirationDate
    ? `\n  <key>ExpirationDate</key>\n  <date>${expirationDate.toISOString()}</date>`
    : '';

  // The function strips outer CMS wrapping by regex-matching the inner plist; we just
  // wrap our test XML in some CMS-like junk so the regex still works.
  const inner = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>${appIdLine}${expLine}
</dict>
</plist>`;

  return `XX-CMS-WRAPPER-XX${inner}YY-CMS-WRAPPER-YY`;
}

// Run one call with exactly these env vars set (undefined deletes the key), then
// put the environment back the way it was.
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

  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'validate-certs: provisioning profile parsing, and the shapes CSC_LINK takes',
  tests: [
    {
      name: 'parseProvision extracts plist from CMS-wrapped file',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const profPath = path.join(tmpDir, 'test.provisionprofile');
        fs.writeFileSync(profPath, makeMockProvision({
          appId: 'TEAMID.com.itwcw.testapp',
          expirationDate: new Date('2099-01-01T00:00:00Z'),
        }));

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.parsed).toBeTruthy();
          ctx.expect(result.parsed['application-identifier']).toBe('TEAMID.com.itwcw.testapp');
          ctx.expect(result.parsed.ExpirationDate).toBeInstanceOf(Date);
          ctx.expect(result.raw).toContain('<plist');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'parseProvision returns nulls for malformed file',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const profPath = path.join(tmpDir, 'bad.provisionprofile');
        fs.writeFileSync(profPath, 'this is not a plist at all');

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.parsed).toBeNull();
          ctx.expect(result.raw).toBeNull();
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'parseProvision handles missing file',
      run: (ctx) => {
        const result = validateCerts.parseProvision('/nonexistent/path.provisionprofile');
        ctx.expect(result.parsed).toBeNull();
      },
    },
    {
      name: 'parseProvision raw string contains the appId for substring match logic',
      run: (ctx) => {
        // The validator checks `parsed.raw.includes(expectedAppId)` — confirm the raw is
        // searchable for that.
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-test-'));
        const profPath = path.join(tmpDir, 'app.provisionprofile');
        fs.writeFileSync(profPath, makeMockProvision({
          appId: 'TEAMID.com.itwcw.somiibo',
          expirationDate: new Date('2099-01-01T00:00:00Z'),
        }));

        try {
          const result = validateCerts.parseProvision(profPath);
          ctx.expect(result.raw.includes('com.itwcw.somiibo')).toBe(true);
          ctx.expect(result.raw.includes('com.itwcw.different-app')).toBe(false);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
    // BOTH mac credentials take three shapes
    // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): a path, an https
    // URL, or the file itself as inline base64. The build workflow ships two of them,
    // because only the mac job decodes the base64 secrets to files, and treating that
    // base64 as a path threw ENAMETOOLONG out of the precheck: first on CSC_LINK,
    // then, once that was fixed, on APPLE_API_KEY.
    // The cloud provider is read where sign-windows and the build read it,
    // `platforms.win.signing.cloud.provider` (#872): the checker used to look
    // under `targets`, so a configured provider was always "not set" and its
    // env vars were never checked.
    {
      name: 'the Windows cloud provider is read from platforms.win, and its env vars are checked',
      run: (ctx) => {
        const config = { platforms: { win: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } };
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
      name: 'a cert of any shape still wants CSC_KEY_PASSWORD',
      run: (ctx) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-csc-'));
        const inline = 'MIIKvwIBAzCCCn8GCSqGSIb3DQEHAaCCCnAEggpsMIIKaDCCBR8'.repeat(60);

        try {
          const issues = [];
          withEnv({ CSC_KEY_PASSWORD: undefined }, () => validateCerts.checkSigningCert(issues, inline, tmpDir));
          ctx.expect(issues.length).toBe(1);
          ctx.expect(issues[0].severity).toBe('warn');
          ctx.expect(issues[0].message).toContain('CSC_KEY_PASSWORD');
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
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
  ],
});
