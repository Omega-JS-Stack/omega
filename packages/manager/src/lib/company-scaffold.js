/**
 * Company-workspace scaffolding — the file plan `omega company init` writes.
 *
 * The COMPANY rung's counterpart to lib/scaffold.js (brands): a company
 * workspace is a REPO, not a machine cache — the config layer every brand
 * inherits, the `.env` that sits UNDER every brand's own, and the shared
 * Apple signing tree — so init is one plan of files in one directory, written
 * with the same fill-missing semantics (existing files are never touched).
 *
 * What the repo TRACKS is the config skeleton, the README, and the
 * .gitignore. Everything the workspace holds that is unshareable stays out of
 * git: `.env` (secrets), `.omega/` (the signing tree's `.p8`/`.p12`/CSR
 * private keys, run output, logs), and `brands/` (each managed brand is its
 * OWN repo — never an embedded one).
 */

const path = require('node:path');

// The .env template is a canonical render with NO values — one SSOT
// (lib/env-order.js) shared with the brand scaffold stub and every
// writeEnvValue writeback, so a company .env and a brand .env look alike.
const { renderCanonicalEnv } = require('./env-order.js');

// The ONE environment vocabulary — the same three overlays the brand scaffold
// plans beside its own .env (#586)
const { ENV_ENVIRONMENTS } = require('@omega.js/config');

// Directories init guarantees. The signing tree is the certificates service's
// layout under {signingRoot}/.omega/certificates/apple/ — created empty so
// the operator has an obvious home for the App Store Connect `AuthKey_*.p8`
// before any run; `brands/` is the default `brands.roots` entry (a missing
// one is a company-config error on the next manage).
const COMPANY_DIRS = [
  'brands',
  '.omega/certificates/apple/certificates',
  '.omega/certificates/apple/csr',
  '.omega/certificates/apple/profiles',
];

/**
 * The company-level config/omega.json5: the `brands` key (which is what MAKES
 * a directory a company root) plus commented, brand-agnostic placeholders for
 * the layers a company usually owns. Every key here is a DEFAULT its brands
 * inherit and can override.
 */
function renderCompanyConfig(name) {
  return [
    `// ${name} — company-level omega.json5: the config layer EVERY managed brand`,
    '// inherits (manager DEFAULTS ← this file ← the brand ← the brand\'s targets), so a key',
    '// set here is a default any brand can override in its own config/omega.json5.',
    '// Secrets NEVER live here — they go in the gitignored .env beside this file.',
    '{',
    '  // Where the brands are, RELATIVE to this root (absolute paths are an error).',
    '  // Keep them inside the workspace with \'./brands\', or point at the org folder',
    '  // with [\'..\'] to treat this workspace\'s SIBLING directories as the brands.',
    '  brands: {',
    '    roots: ["./brands"],',
    '  },',
    '',
    '  // Company identity — a brand without its own value inherits these.',
    '  // brand: {',
    '  //   name: "My Company",',
    '  //   url: "https://mycompany.com",',
    '  //   contact: { email: "support@mycompany.com" },',
    '  // },',
    '',
    '  // Managed Firebase Auth accounts every brand should carry (account service).',
    '  // Passwords never live here — see the brand scaffold\'s notes on the seed.',
    '  // account: {',
    '  //   admins: [',
    '  //     { email: "you@mycompany.com", account: true, marketing: false },',
    '  //   ],',
    '  // },',
    '',
    '  // The company GA account: a brand\'s analytics setup defaults to it instead',
    '  // of prompting for one (a brand-level accountId always wins).',
    '  // analytics: {',
    '  //   providers: { google: { accountId: "123456789" } },',
    '  // },',
    '',
    '  // Error monitoring: the Sentry org every brand\'s projects live under.',
    '  // monitoring: {',
    '  //   providers: { sentry: { org: "my-company" } },',
    '  // },',
    '',
    '  // Apple signing: ONE Apple account signs everything the company ships, so',
    '  // the reverse-DNS prefix (and the signing tree below) belongs here.',
    '  // certificates: {',
    '  //   providers: { apple: { bundleIdPrefix: "com.mycompany" } },',
    '  // },',
    '}',
    '',
  ].join('\n');
}

/**
 * The company `.env` template — every canonical group, every key commented
 * out. Nothing is generated: the company file holds only what EVERY brand
 * shares (the Apple signing account, a company-wide token), and a brand's own
 * `.env` wins over it.
 */
function renderCompanyEnvStub(name) {
  return renderCanonicalEnv({
    header: [
      `# ${name} — COMPANY secrets (gitignored; loaded UNDER every managed brand's own .env).`,
      '# Precedence: shell env > brand .env > this file. Put here only what every brand',
      '# shares — anything brand-specific belongs in that brand\'s .env, never here.',
    ],
  });
}

/**
 * A company environment-overlay stub — a header comment and NOTHING else, the
 * same shape the BRAND scaffold plans
 * ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)). The company
 * layer is a layer like any other: its `.env` is the one file that documents
 * the keys, and an overlay holds only the handful that differ for one
 * environment (a sandbox Apple account, a staging token).
 *
 * @param {string} environment - `development` | `testing` | `production`.
 * @returns {string} The file contents.
 */
function renderCompanyEnvOverlayStub(environment) {
  return [
    `# .env.${environment} — overlays .env when a managed brand runs in ${environment} (gitignored).`,
    '# Only the keys that differ — anything not set here falls through to .env.',
    '',
  ].join('\n');
}

/**
 * The company repo's .gitignore. The `.omega/` and `logs/` entries match the
 * shared healer's (lib/gitignore.js) exactly, so a company root scaffolded
 * here is already 'present' when a company run checks.
 */
function renderCompanyGitignore() {
  return [
    '# Dependencies',
    'node_modules/',
    '',
    '# Omega manager state (durable IDs + per-run output) — and the SHARED SIGNING',
    '# TREE: .omega/certificates/apple/ holds Apple private key material (.p8, .p12,',
    '# CSR keys). It never goes in git — move it between machines out of band.',
    '.omega/',
    '',
    '# Run logs (truncated on every launch — never committed)',
    'logs/',
    '',
    '# Secrets — the shared .env and its per-environment overlays',
    '.env',
    '.env.*',
    '',
    '# Managed brands — each one is its OWN git repo, never embedded in this one',
    'brands/',
    '',
    '# OS',
    '.DS_Store',
    '',
  ].join('\n');
}

function renderCompanyReadme(name) {
  return `# ${name}

The OMEGA **company workspace** — the layer every brand this company ships
inherits. It is a repo, not a machine cache: config, shared secrets, and the
shared Apple signing tree live here, and each brand stays its own repo.

## What's here

- \`config/omega.json5\` — the company config layer (\`brands.roots\` says where the
  brands are; every other key is a default a brand can override).
- \`.env\` — company secrets, loaded UNDER each brand's own \`.env\`
  (shell > brand \`.env\` > this file). Gitignored.
- \`.env.<environment>\` — the per-environment overlay (\`development\`, \`testing\`,
  \`production\`): only the keys that differ there.
- \`.omega/certificates/apple/\` — the shared Apple signing tree: one Apple
  account signs everything the company ships. Gitignored; drop the App Store
  Connect \`AuthKey_*.p8\` here.
- \`brands/\` — the managed brands (each its own git repo; gitignored here).

## Verbs

\`\`\`bash
npx omega company adopt <brand-path>  # stamp an existing brand: it inherits this company
npx omega onboard                     # create a NEW brand under brands/ (stamped for you)
npx omega manage                      # the full manage walk, once per managed brand
npx omega manage --brand=<id>         # ... just one brand
npx omega manage --parallel           # ... every brand concurrently
\`\`\`
`;
}

/**
 * Build the scaffold plan for a company workspace.
 *
 * @param {string} name - Display name for the generated headers (the dir name)
 * @returns {Array<{ path: string, contents: string }>} - Company-root-relative file plan
 */
function buildCompanyScaffoldPlan(name) {
  return [
    { path: path.join('config', 'omega.json5'), contents: renderCompanyConfig(name) },
    { path: '.gitignore', contents: renderCompanyGitignore() },
    { path: '.env', contents: renderCompanyEnvStub(name) },
    ...ENV_ENVIRONMENTS.map((environment) => ({ path: `.env.${environment}`, contents: renderCompanyEnvOverlayStub(environment) })),
    { path: 'README.md', contents: renderCompanyReadme(name) },
    // Self-protecting: signing material can never be committed even if the
    // root .gitignore is edited or the tree is copied into another repo.
    { path: path.join('.omega', 'certificates', 'apple', '.gitignore'), contents: '*\n!.gitignore\n' },
  ];
}

module.exports = { COMPANY_DIRS, buildCompanyScaffoldPlan };
