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
// The canonical group list + renderer live in env-order.js (the ordering
// SSOT, cp137) — the stub is just a canonical render with generated Omega
// keys, so a scaffolded .env and a reordered one have the same shape.
const { renderCanonicalEnv } = require('./env-order.js');

// The backend framework is a Cloud Functions RUNTIME dependency — the stage
// step derives dist/package.json from the app manifest's `dependencies`
// (src/dist pillar). Every other target's framework is build-time only.
const RUNTIME_DEP_TARGETS = ['backend'];

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
      '  // id at launch (the cloud service can create one).',
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
  );

  // App-signing brands get their reverse-DNS bundle prefix derived at
  // onboarding (parent company's domain when one exists, else the brand's)
  if (answers.targets.includes('desktop') && answers.bundleIdPrefix) {
    lines.push(
      '  // Apple signing (certificates service): reverse-DNS prefix derived from',
      '  // the company/brand domain at onboarding. Bundle IDs mint as',
      '  // <prefix>.<brand id with dashes as dots>.',
      '  certificates: {',
      '    apple: {',
      `      bundleIdPrefix: ${JSON.stringify(answers.bundleIdPrefix)},`,
      '    },',
      '  },',
      '',
    );
  }

  lines.push(
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
    // npm scripts put node_modules/.bin on PATH, so plain `omega` (the
    // context-aware dispatcher) resolves — never the retired omega-manager name
    scripts: {
      start: 'omega',
      dev: 'omega dev',
      deploy: 'omega deploy',
    },
    // Brand-level verbs (`omega dev`, manage, the `start` script above) resolve
    // @omega.js/manager FROM THE BRAND ROOT (omega-bin dispatch) — without this
    // declaration nothing installs it outside the monorepo and every brand-root
    // command dies (cp195 journey catch).
    devDependencies: {
      '@omega.js/manager': '*',
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
  const generated = {
    OMEGA_ADMIN_KEY: randomBytes(32).toString('base64url'),
    OMEGA_WEBHOOK_KEY: randomBytes(32).toString('base64url'),
    OMEGA_NAMESPACE: randomUUID(),
  };

  return renderCanonicalEnv({
    header: [
      `# ${answers.name} — brand secrets (gitignored; loaded before every omega run).`,
      '# Uncomment and fill what this brand uses. Services without their credentials',
      '# skip cleanly, so add these as the brand adopts each service.',
    ],
    entries: new Map(Object.entries(generated).map(([key, value]) => [key, { raw: `${key}=${value}` }])),
  });
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
source of user choices; \`omega\` reconciles every external service
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
4. \`npx omega\` — reconcile everything; rerun any time.
`;
}

function renderAppPackageJson(answers, target, dir) {
  const framework = TARGET_FRAMEWORKS[target];
  // `*`: satisfied by a workspace link in-monorepo, `mgr i local` pre-publish,
  // and the npm registry once @omega.js/* publish.
  const depKey = RUNTIME_DEP_TARGETS.includes(target) ? 'dependencies' : 'devDependencies';

  // version + author: electron-builder hard-requires version and warns on
  // author (the cp142 rehearsal catch) — every app gets both, they're healthy
  return `${JSON.stringify({
    name: `${answers.id}-${dir}`,
    version: '0.0.1',
    author: answers.name,
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
