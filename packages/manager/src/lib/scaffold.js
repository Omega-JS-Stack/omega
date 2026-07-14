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
 * App package.jsons carry their framework dep (`*` — satisfied by workspace
 * links in a monorepo, `mgr i local` pre-publish, npm post-publish; dogfood
 * friction #2), so install → setup works without hand-editing; each
 * framework's own setup still owns the consumer INTERIOR (scripts, config,
 * scaffolded files). The backend's framework is a RUNTIME dependency (it
 * rides the staged dist/package.json — src/dist pillar); every other target
 * declares its framework as a devDependency (build-time only).
 */

const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const jetpack = require('fs-jetpack');

const { TARGET_APP_DIRS, TARGET_FRAMEWORKS } = require('../config.js');

// The backend framework is a Cloud Functions RUNTIME dependency — the stage
// step derives dist/package.json from the app manifest's `dependencies`
// (src/dist pillar). Every other target's framework is build-time only.
const RUNTIME_DEP_TARGETS = ['backend'];

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
  { comment: 'Email marketing (sendgrid + beehiiv services)', keys: ['SENDGRID_API_KEY', 'BEEHIIV_API_KEY'] },
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
    '  // AI translation (web /{lang}/ pages, extension _locales). Provider',
    '  // "claude" (default) rides the local Claude Code install — no API key;',
    '  // "chatgpt" needs OPENAI_API_KEY in .env. Uncomment to enable:',
    '  // translation: {',
    '  //   languages: ["es", "fr", "de"],',
    '  // },',
    '',
  );

  // Only a CUSTOMIZED admin list lands here — an inherited one (company
  // config or the built-in support@{domain} default) stays unwritten so the
  // source layer keeps owning it.
  if (answers.accountAdmins) {
    lines.push(
      '  // Managed Firebase Auth accounts (account service). Passwords never live',
      '  // here — OMEGA_ACCOUNT_PASSWORD__* env vars, config/hooks/account/password.js,',
      '  // or the generated ACCOUNT_PASSWORD_SEED.',
      '  account: {',
      '    admins: [',
    );
    for (const entry of answers.accountAdmins) {
      lines.push(`      { email: ${JSON.stringify(entry.email)}, account: ${!!entry.account}, marketing: ${!!entry.marketing} },`);
    }
    lines.push('    ],', '  },', '');
  }

  // Backend brands get a bootable cloud project out of the box: demo-* ids
  // are the emulator-only convention (never touch live Firebase), so the
  // emulator boots before any real project exists (dogfood friction #3).
  if (answers.targets.includes('backend')) {
    lines.push(
      '  // Cloud project (backend target). demo-* ids are EMULATOR-ONLY — the',
      '  // emulators boot against this immediately; swap in a real Firebase project',
      '  // id at launch (the firebase service can create one).',
      '  cloud: {',
      '    provider: "firebase",',
      '    config: {',
      `      projectId: ${JSON.stringify(`demo-${answers.id}`)},`,
      '    },',
      '  },',
      '',
    );
  }

  lines.push(
    '  // Payment catalog — pricing pages render THESE products (no products =',
    '  // honest empty state). Uncomment + edit to start selling; ids are',
    '  // permanent once live. Processor id fields (stripe/paypal/chargebee) are',
    '  // filled by the payment service — leave them null. Presentation fields',
    '  // (tagline, popular, features) are optional card garnish.',
    '  // payment: {',
    '  //   products: [',
    '  //     {',
    '  //       id: "premium",',
    '  //       name: "Premium",',
    '  //       type: "subscription",',
    '  //       tagline: "best for teams",',
    '  //       popular: true,',
    '  //       prices: { monthly: 9.99, annually: 99.99 },',
    '  //       trial: { days: 14 },',
    '  //       limits: { requests: 10000 },',
    '  //       features: [{ id: "requests", name: "Requests", icon: "sparkles" }],',
    '  //     },',
    '  //     { id: "launch-kit", name: "Launch Kit", type: "one-time", prices: { once: 49.99 } },',
    '  //   ],',
    '  // },',
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
    '',
    '# ── Omega keys (auto-generated at scaffold — rotate by replacing the value) ──',
    '# Admin key: grants admin on your backend. Webhook key: authenticates third-party',
    '# webhook deliveries. Namespace: the brand UUID namespace for deterministic ids.',
    `OMEGA_ADMIN_KEY=${randomBytes(32).toString('base64url')}`,
    `OMEGA_WEBHOOK_KEY=${randomBytes(32).toString('base64url')}`,
    `OMEGA_NAMESPACE=${randomUUID()}`,
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

1. \`npm install\` — each app declares its framework (workspace link in a
   monorepo; standalone pre-publish: \`npx mgr i local\` inside each app).
2. Per app: \`cd apps/<dir> && npx omega setup\` — the framework scaffolds its
   consumer interior.
3. Fill in \`.env\` as the brand adopts external services.
4. \`npx omega-manager\` — reconcile everything; rerun any time.
`;
}

function renderAppPackageJson(answers, target, dir) {
  const framework = TARGET_FRAMEWORKS[target];
  // `*`: satisfied by a workspace link in-monorepo, `mgr i local` pre-publish,
  // and the npm registry once @omega.js/* publish.
  const depKey = RUNTIME_DEP_TARGETS.includes(target) ? 'dependencies' : 'devDependencies';

  return `${JSON.stringify({
    name: `${answers.id}-${dir}`,
    private: true,
    description: `${answers.name} ${target} app`,
    ...(framework ? { [depKey]: { [framework]: '*' } } : {}),
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
