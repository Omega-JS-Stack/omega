/**
 * Company-tree scaffolding: the file plan `omega company init` writes into
 * `company/`, INSIDE the company brand's own repo
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * The tree is shaped like a brand, because that IS the inheritance rule: a
 * brand-level file the child lacks resolves from the company's `company/` at
 * the same relative path (@omega.js/config's `resolveCompany().file()`). So
 * the plan is the brand plan's shared half: the config layer, the `.env`
 * that loads under every brand's own, the signing tree, the shared PSD
 * templates, and nothing brand-specific.
 *
 * What the parent repo TRACKS of it is the config skeleton, the README and
 * the .gitignore. Everything unshareable stays out of git exactly as it does
 * at the brand root: `.env*` (secrets) and `.omega/` (the signing tree's
 * `.p8`/`.p12`/CSR private keys).
 */

const path = require('node:path');

// The .env template is a canonical render with NO values — one SSOT
// (lib/env-order.js) shared with the brand scaffold stub and every
// writeEnvValue writeback, so a company .env and a brand .env look alike.
const { renderCanonicalEnv } = require('./env-order.js');

// Directories init guarantees inside the tree, company-dir-relative. The
// signing tree is the certificates service's layout under
// .omega/certificates/apple/: created empty so the operator hasan obvious
// home for the App Store Connect `AuthKey_*.p8` before any run; the templates
// dir is what the assets service seeds a brand's PSDs from.
const COMPANY_DIRS = [
  '.omega/certificates/apple/certificates',
  '.omega/certificates/apple/csr',
  'assets/templates',
];

/**
 * The company config LAYER: brand-agnostic placeholders only. Every key here
 * is a default the company's brands inherit and can override, and the file
 * itself is never a brand: it carries no `brand.id`, no targets, nothing
 * about the parent brand it sits inside.
 *
 * @param {string} name - The company brand's display name.
 * @returns {string} The file contents.
 */
function renderCompanyConfig(name) {
  return [
    `// ${name}: the COMPANY config layer, every brand naming this company with`,
    '// `company: { id }` inherits it (schema defaults ← framework defaults ← THIS FILE ←',
    '// the brand ← its targets ← local), so a key set here is a default any brand can',
    '// override in its own config/omega.json5. Nothing brand-specific belongs here, and',
    '// secrets NEVER do: they go in the gitignored .env beside this file.',
    '{',
    '  // Company identity — a brand without its own value inherits these.',
    '  // brand: {',
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
    '  // the reverse-DNS prefix (and the signing tree beside this file) belongs here.',
    '  // certificates: {',
    '  //   providers: { apple: { bundleIdPrefix: "com.mycompany" } },',
    '  // },',
    '}',
    '',
  ].join('\n');
}

/**
 * The company `.env` template — every canonical group, every key commented
 * out, the same shape a brand `.env` has. Nothing is generated: the company
 * file holds only what EVERY brand shares (the Apple signing account, a
 * company-wide token), and a brand's own `.env` wins over it.
 *
 * @param {string} name - The company brand's display name.
 * @returns {string} The file contents.
 */
function renderCompanyEnvStub(name) {
  return renderCanonicalEnv({
    header: [
      `# ${name}: COMPANY secrets (gitignored; loaded UNDER every brand of this company).`,
      '# Precedence: shell env > brand .env > this file. Put here only what every brand',
      '# shares — anything brand-specific belongs in that brand\'s .env, never here.',
    ],
  });
}

/**
 * The tree's own .gitignore. The parent repo's root .gitignore already
 * carries these rules; this one mirrors them so the unshareable half can
 * never be committed by a root-file edit or a copy of the tree.
 *
 * @returns {string} The file contents.
 */
function renderCompanyGitignore() {
  return [
    '# Secrets — the shared .env and its per-environment overlays',
    '.env',
    '.env.*',
    '',
    '# The SHARED SIGNING TREE: .omega/certificates/apple/ holds Apple private key',
    '# material (.p8, .p12, CSR keys). It never goes in git; move it between',
    '# machines out of band.',
    '.omega/',
    '',
  ].join('\n');
}

/**
 * @param {string} name - The company brand's display name.
 * @returns {string} The README contents.
 */
function renderCompanyReadme(name) {
  return `# ${name}: company layer

The files every brand of this company inherits. A brand joins by naming it:
\`company: { id: '<this brand's brand.id>' }\` in its own \`config/omega.json5\`.

Inheritance is ONE rule: a brand-level file the child lacks resolves from here
at the same relative path, so a new kind of shared file costs no code.

- \`config/omega.json5\`: the config layer (under the brand's own file).
- \`.env\`: the shared secrets, loaded UNDER each brand's own \`.env\`
  (shell > brand \`.env\` > this file). Gitignored.
- \`.omega/certificates/apple/\` — the shared Apple signing tree: one Apple
  account signs everything the company ships. Gitignored; drop the App Store
  Connect \`AuthKey_*.p8\` here.
- \`assets/templates/\`: the shared PSD templates a brand's assets run seeds from.
- \`config/hooks/<point>.js\`: company-wide owner hooks (the brand's own wins).

Resolved, never copied: nothing here is written into a brand.
`;
}

/**
 * Build the scaffold plan for a company tree.
 *
 * @param {string} name - The company brand's display name (headers only).
 * @returns {Array<{ path: string, contents: string }>} Company-dir-relative file plan.
 */
function buildCompanyScaffoldPlan(name) {
  return [
    { path: path.join('config', 'omega.json5'), contents: renderCompanyConfig(name) },
    { path: '.gitignore', contents: renderCompanyGitignore() },
    { path: '.env', contents: renderCompanyEnvStub(name) },
    { path: 'README.md', contents: renderCompanyReadme(name) },
  ];
}

module.exports = { COMPANY_DIRS, buildCompanyScaffoldPlan };
