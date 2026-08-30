// derive-signing-env tests — the .env stamp the manager's disperse service used
// to write is derived at build time instead
// ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const deriveSigningEnv = require('../../../utils/derive-signing-env.js');

function stageTarget(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-derive-'));
  for (const file of files) {
    jetpack.write(path.join(tmp, 'config', 'certs', file), 'artifact');
  }
  return tmp;
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'derive-signing-env',
  tests: [
    {
      name: 'unset + the file is delivered → the target-relative path is set',
      run: (ctx) => {
        const tmp = stageTarget(['developer-id-application.p12', 'AuthKey_ABCDE12345.p8']);

        try {
          const env = { APPLE_API_KEY_ID: 'ABCDE12345' };
          const derived = deriveSigningEnv({ env, projectDir: tmp });

          ctx.expect(env.CSC_LINK).toBe('config/certs/developer-id-application.p12');
          ctx.expect(env.APPLE_API_KEY).toBe('config/certs/AuthKey_ABCDE12345.p8');
          ctx.expect(derived.map((entry) => entry.key).sort()).toEqual(['APPLE_API_KEY', 'CSC_LINK']);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'already set → never overridden (an explicit answer wins)',
      run: (ctx) => {
        const tmp = stageTarget(['developer-id-application.p12', 'AuthKey_ABCDE12345.p8']);

        try {
          const env = {
            APPLE_API_KEY_ID: 'ABCDE12345',
            CSC_LINK: '/keychain/mine.p12',
            APPLE_API_KEY: '/secrets/AuthKey.p8',
          };
          const derived = deriveSigningEnv({ env, projectDir: tmp });

          ctx.expect(env.CSC_LINK).toBe('/keychain/mine.p12');
          ctx.expect(env.APPLE_API_KEY).toBe('/secrets/AuthKey.p8');
          ctx.expect(derived).toEqual([]);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the file is absent → the key stays unset (electron-builder skips/auto-discovers)',
      run: (ctx) => {
        const tmp = stageTarget([]);

        try {
          const env = { APPLE_API_KEY_ID: 'ABCDE12345' };
          const derived = deriveSigningEnv({ env, projectDir: tmp });

          ctx.expect('CSC_LINK' in env).toBe(false);
          ctx.expect('APPLE_API_KEY' in env).toBe(false);
          ctx.expect(derived).toEqual([]);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no APPLE_API_KEY_ID → no notarization path to derive',
      run: (ctx) => {
        const tmp = stageTarget(['AuthKey_ABCDE12345.p8']);

        try {
          const env = {};
          deriveSigningEnv({ env, projectDir: tmp });

          ctx.expect('APPLE_API_KEY' in env).toBe(false);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // The gulp boot is too heavy to require here (it pulls in Manager, gulp and
      // every task), so the call site is checked statically: the option name has
      // to be the one the deriver reads, and the value it passes has to be a
      // binding main.js actually declares. Shipped bound to an undeclared
      // `projectDir` once, which is a ReferenceError on every desktop build.
      name: 'the gulp main call site passes a declared binding as projectDir',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'gulp', 'main.js'), 'utf8');
        const call = source.match(/require\('\.\.\/utils\/derive-signing-env\.js'\)\(\{([^}]*)\}\)/);
        ctx.expect(call).toBeTruthy();

        const options = {};
        for (const part of call[1].split(',')) {
          const [name, value] = part.split(':').map((piece) => piece.trim());
          options[name] = value === undefined ? name : value;
        }

        ctx.expect(Object.keys(options).sort()).toEqual(['env', 'projectDir']);

        const binding = options.projectDir;
        const declared = new RegExp(`\\b(?:const|let|var)\\s+${binding}\\s*=`).test(source);
        ctx.expect(declared).toBe(true);
      },
    },
  ],
};
