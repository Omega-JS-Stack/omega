/**
 * Brand-monorepo scaffolding — the file plan the onboard wizard writes.
 *
 * buildScaffoldPlan() turns the wizard's answers into the plan-§0 skeleton:
 * config/omega.json5, root package.json (apps/* workspaces), .gitignore, the
 * .env credential stub, README.md, and a minimal package.json per enabled
 * target's app dir. applyScaffoldPlan() writes it with fill-missing
 * semantics: existing files are NEVER touched, so onboarding is idempotent
 * and re-running it into a partial brand only fills the gaps.
 *
 * Deliberately structural: no framework deps are wired into the app
 * package.jsons — each framework's own setup owns its consumer internals,
 * and the update service records dep-less, build-less apps as skipped, not
 * failed. The testing service's "build output missing — run the update
 * service" error on a fresh brand is the designed next-step nudge.
 */

const path = require('node:path');
const jetpack = require('fs-jetpack');

const { TARGET_APP_DIRS, TARGET_FRAMEWORKS } = require('../config.js');

// Secret names each service reads from the brand .env — the stub documents
// every entry point so "where do credentials go" has one obvious answer.
// The names are owned by the services (see each service's README row).
const ENV_GROUPS = [
  { comment: 'GitHub (github + seo services) — `gh auth login` works instead of a token', keys: ['GH_TOKEN'] },
  { comment: 'Cloudflare (cloudflare service + every DNS-writing flow) — API token with Zone edit', keys: ['CLOUDFLARE_TOKEN'] },
  { comment: 'Namecheap registrar (domain service)', keys: ['NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY'] },
  { comment: 'Google OAuth client (firebase, analytics, search-console, adsense services)', keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  { comment: 'Classic reCAPTCHA keys, shared across brands (recaptcha service)', keys: ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY'] },
  { comment: 'Pixel access tokens (analytics service; the names @omega.js/backend reads)', keys: ['META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN'] },
  { comment: 'Email marketing (sendgrid + beehiiv services) + the parent @omega.js/backend webhook key', keys: ['SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'BACKEND_MANAGER_WEBHOOK_KEY'] },
  { comment: 'Payment processors (payment service; public halves live in omega.json5)', keys: ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY'] },
  { comment: 'Operator service accounts (slapform/chatsy/replyify/server services) — paths to service-account JSON files', keys: ['SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT'] },
  { comment: 'Apple signing (certificates service — desktop/mobile targets)', keys: ['APPLE_API_ISSUER', 'APPLE_API_KEY_ID', 'APPLE_TEAM_ID'] },
];

/**
 * Render the brand-level config/omega.json5 (fresh brands only — an existing
 * config is never regenerated). String values go through JSON.stringify, so
 * user input can't break the file.
 */
function renderOmegaConfig(answers) {
  const lines = [
    `// ${answers.name} — brand-level omega.json5: the shared config layer every app`,
    '// under apps/ inherits. App files override any key per-surface; key presence',
    '// under `targets` = this brand supports that target. Secrets NEVER live here —',
    '// they go in the gitignored .env (the loader hard-fails on secret-shaped keys).',
    '{',
    '  brand: {',
    `    id: ${JSON.stringify(answers.id)},`,
    `    name: ${JSON.stringify(answers.name)},`,
  ];

  if (answers.description) {
    lines.push(`    description: ${JSON.stringify(answers.description)},`);
  }
  if (answers.tagline) {
    lines.push(`    tagline: ${JSON.stringify(answers.tagline)},`);
  }

  lines.push(
    `    url: ${JSON.stringify(answers.url)},`,
    '    contact: {',
    `      email: ${JSON.stringify(answers.email)},`,
    '    },',
    '  },',
    '',
    '  // Project-owned theme — seeded at onboarding, yours to change.',
    '  theme: {',
    '    id: "classy",',
    '    appearance: "system", // "system" | "light" | "dark"',
    '  },',
    '',
    '  // Key presence = target enabled; the value is that target\'s type-wide',
    '  // config (any shared key inside overrides it for that surface).',
    '  targets: {',
  );

  for (const target of answers.targets) {
    lines.push(`    ${target}: {},`);
  }

  lines.push('  },', '}');

  return `${lines.join('\n')}\n`;
}

function renderRootPackageJson(answers) {
  return `${JSON.stringify({
    name: answers.id,
    private: true,
    ...(answers.description ? { description: answers.description } : {}),
    workspaces: ['apps/*'],
    scripts: {
      start: 'omega-manager',
    },
  }, null, 2)}\n`;
}

function renderGitignore() {
  return [
    '# Dependencies',
    'node_modules/',
    '',
    '# Build output',
    'dist/',
    '',
    '# OMEGA manager state (derived data — never committed)',
    '.omega/',
    '',
    '# Secrets',
    '.env',
    '',
    '# OS',
    '.DS_Store',
    '',
  ].join('\n');
}

function renderEnvStub(answers) {
  const lines = [
    `# ${answers.name} — brand secrets (gitignored; loaded before every omega-manager run).`,
    '# Uncomment and fill what this brand uses. Services without their credentials',
    '# skip cleanly, so add these as the brand adopts each service.',
  ];

  for (const group of ENV_GROUPS) {
    lines.push('', `# ── ${group.comment} ──`);
    for (const key of group.keys) {
      lines.push(`# ${key}=`);
    }
  }

  lines.push(
    '',
    '# Auto-generated and persisted here on the first real run — leave unset:',
    '# ACCOUNT_PASSWORD_SEED, CSC_KEY_PASSWORD',
    '',
  );

  return lines.join('\n');
}

function renderReadme(answers) {
  const appList = answers.targets
    .map((target) => {
      const dir = TARGET_APP_DIRS[target] || target;
      const framework = TARGET_FRAMEWORKS[target];
      return `- \`apps/${dir}/\` — the ${target} app${framework ? ` (framework: \`${framework}\`)` : ''}`;
    })
    .join('\n');

  return `# ${answers.name}

${answers.description || 'An OMEGA brand monorepo.'}

One repo, every surface of the brand. \`config/omega.json5\` is the single
source of user choices; \`omega-manager\` reconciles every external service
to it, idempotently.

## Structure

- \`config/omega.json5\` — brand-level shared config (apps inherit + override)
${appList}
- \`.env\` — credentials (gitignored; see the stub for every service's keys)
- \`.omega/\` — manager state + run output (gitignored, machine-owned)

## Next steps

1. Install each app's framework and run its setup (see the app list above).
2. Fill in \`.env\` as the brand adopts external services.
3. \`npx omega-manager\` — reconcile everything; rerun any time.
`;
}

function renderAppPackageJson(answers, target, dir) {
  return `${JSON.stringify({
    name: `${answers.id}-${dir}`,
    private: true,
    description: `${answers.name} ${target} app`,
  }, null, 2)}\n`;
}

/**
 * Build the scaffold plan for a brand.
 *
 * @param {Object} answers - { id, name, description, tagline, url, email, targets }
 * @returns {Array<{ path: string, contents: string }>} - Brand-root-relative file plan
 */
function buildScaffoldPlan(answers) {
  const plan = [
    { path: 'config/omega.json5', contents: renderOmegaConfig(answers) },
    { path: 'package.json', contents: renderRootPackageJson(answers) },
    { path: '.gitignore', contents: renderGitignore() },
    { path: '.env', contents: renderEnvStub(answers) },
    { path: 'README.md', contents: renderReadme(answers) },
  ];

  for (const target of answers.targets) {
    const dir = TARGET_APP_DIRS[target] || target;
    plan.push({ path: `apps/${dir}/package.json`, contents: renderAppPackageJson(answers, target, dir) });
  }

  return plan;
}

/**
 * Write a scaffold plan with fill-missing semantics: files that already
 * exist are never touched (rerunning onboard converges instead of clobbering).
 *
 * @param {string} brandRoot - Absolute brand root to scaffold into
 * @param {Array<{ path, contents }>} plan - From buildScaffoldPlan()
 * @param {Object} [options] - { dryRun } — plan only, zero writes
 * @returns {{ created: string[], kept: string[], planned: string[] }}
 */
function applyScaffoldPlan(brandRoot, plan, { dryRun = false } = {}) {
  const created = [];
  const kept = [];
  const planned = [];

  for (const file of plan) {
    const destination = path.join(brandRoot, file.path);

    if (jetpack.exists(destination)) {
      kept.push(file.path);
      continue;
    }

    if (dryRun) {
      planned.push(file.path);
      continue;
    }

    jetpack.write(destination, file.contents);
    created.push(file.path);
  }

  return { created, kept, planned };
}

module.exports = { buildScaffoldPlan, applyScaffoldPlan };
