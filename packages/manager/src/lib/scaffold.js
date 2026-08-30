/**
 * Brand-monorepo scaffolding — the file plan the onboard wizard writes.
 *
 * buildScaffoldPlan() turns the wizard's answers into the plan-§0 skeleton:
 * config/omega.json5, root package.json (targets/* workspaces), .gitignore, the
 * .env credential stub, README.md, and a minimal package.json per enabled
 * target's own dir. applyScaffoldPlan() writes it with fill-missing
 * semantics: existing files are NEVER touched, so onboarding is idempotent
 * and re-running it into a partial brand only fills the gaps.
 *
 * Target package.jsons carry their framework dep (`*` — satisfied by workspace
 * links in a monorepo, `mgr i local` pre-publish, npm post-publish; dogfood
 * friction #2), so install → setup works without hand-editing; each
 * framework's own setup still owns the consumer INTERIOR (scripts, config,
 * scaffolded files). The backend's framework is a RUNTIME dependency (it
 * rides the staged dist/package.json — src/dist pillar); every other target
 * declares its framework as a devDependency (build-time only).
 */

const path = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { TARGET_DIRS, TARGET_FRAMEWORKS } = require('../config.js');
// The canonical group list + renderer live in env-order.js (the ordering
// SSOT, cp137) — the stub is just a canonical render with generated Omega
// keys, so a scaffolded .env and a reordered one have the same shape.
const { renderCanonicalEnv, envLine } = require('./env-order.js');
// What gets generated (the env schema's `generated` entries) — with
// env-order.js's serializer above, the same two SSOTs writeEnvValue rides.
const { generatedEnvKeys } = require('@omega.js/config');
// The heal's value is the SSOT for the manage script — a scaffolded brand
// must never be born needing the migration the heal just learned (#229)
const { MANAGE_SCRIPT } = require('./package-scripts.js');

// The backend framework is a Cloud Functions RUNTIME dependency — the stage
// step derives dist/package.json from the target manifest's `dependencies`
// (src/dist pillar). Every other target's framework is build-time only.
const RUNTIME_DEP_TARGETS = ['backend'];

/**
 * Render the brand-level config/omega.json5 (fresh brands only — an existing
 * config is never regenerated). String values go through JSON.stringify, so
 * user input can't break the file.
 */
function renderOmegaConfig(answers) {
  const lines = [
    `// ${answers.name} — brand-level omega.json5: the shared config layer every target`,
    '// under targets/ inherits. Local files override any key per-surface; key presence',
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
    '  // Social handles (platform: "handle") — each entry lights its footer icon, its JSON-LD sameAs entry, and a /<platform> shortlink.',
    '  socials: {},',
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
    '  // permanent once live. Provider id fields (stripe/paypal/chargebee) are',
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
      '    providers: {',
      '      apple: {',
      `        bundleIdPrefix: ${JSON.stringify(answers.bundleIdPrefix)},`,
      '      },',
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
    workspaces: ['targets/*'],
    // npm scripts put node_modules/.bin on PATH, so plain `omega` (the
    // context-aware dispatcher) resolves — never the retired omega-manager name
    // `npm start` boots the dev stack (`dev` stays as its alias); the bare
    // manage cycle is `npm run manage`
    scripts: {
      start: 'omega dev',
      dev: 'omega dev',
      manage: MANAGE_SCRIPT,
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
    '# Run logs (truncated on every launch — never committed)',
    'logs/',
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
  return renderCanonicalEnv({
    header: [
      `# ${answers.name} — brand secrets (gitignored; loaded before every omega run).`,
      '# Uncomment and fill what this brand uses. Services without their credentials',
      '# skip cleanly, so add these as the brand adopts each service.',
    ],
    // The generated keys and their line form come from the SSOTs the
    // manage-time mint uses too (#569), so a brand born here and a brand
    // healed by the env-keys op carry byte-identical shapes.
    entries: new Map(Object.entries(generatedEnvKeys()).map(([key, generate]) => [key, { raw: envLine(key, generate()) }])),
  });
}

function renderReadme(answers) {
  const targetList = answers.targets
    .map((target) => {
      const dir = TARGET_DIRS[target] || target;
      const framework = TARGET_FRAMEWORKS[target];
      return `- \`targets/${dir}/\` — the ${target} target${framework ? ` (framework: \`${framework}\`)` : ''}`;
    })
    .join('\n');

  return `# ${answers.name}

${answers.description || 'An OMEGA brand monorepo.'}

One repo, every surface of the brand. \`config/omega.json5\` is the single
source of user choices; \`omega\` reconciles every external service
to it, idempotently.

## Structure

- \`config/omega.json5\` — brand-level shared config (targets inherit + override)
${targetList}
- \`.env\` — credentials (gitignored; see the stub for every service's keys)
- \`.omega/\` — manager state + run output (gitignored, machine-owned)

## Next steps

1. \`npm install\` — each target declares its framework (workspace link in a
   monorepo; standalone pre-publish: \`npx mgr i local\` inside each target).
2. Fill in \`.env\` as the brand adopts external services.
3. \`npm run manage\` — reconcile everything; rerun any time.
4. \`npm start\` (\`npx omega dev\`) — boot the local stack; each target's verbs
   scaffold its consumer interior on first run.
`;
}

function renderTargetPackageJson(answers, target, dir) {
  const framework = TARGET_FRAMEWORKS[target];
  // `*`: satisfied by a workspace link in-monorepo, `mgr i local` pre-publish,
  // and the npm registry once @omega.js/* publish.
  const depKey = RUNTIME_DEP_TARGETS.includes(target) ? 'dependencies' : 'devDependencies';

  // version + author: electron-builder hard-requires version and warns on
  // author (the cp142 rehearsal catch) — every target gets both, they're healthy
  return `${JSON.stringify({
    name: `${answers.id}-${dir}`,
    version: '0.0.1',
    author: answers.name,
    private: true,
    description: `${answers.name} ${target} target`,
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
    const dir = TARGET_DIRS[target] || target;
    plan.push({ path: `targets/${dir}/package.json`, contents: renderTargetPackageJson(answers, target, dir) });
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

/**
 * Print what a plan did — the one rendering of created/kept/planned, shared
 * by every scaffolding verb (onboard's brand plan, company init's).
 */
function printPlanResults({ created, kept, planned }) {
  for (const file of planned) {
    console.log(`  ${chalk.dim('⊘')} would create ${chalk.cyan(file)}`);
  }
  for (const file of created) {
    console.log(`  ${chalk.green('✓')} created ${chalk.cyan(file)}`);
  }
  for (const file of kept) {
    console.log(`  ${chalk.dim('•')} kept ${chalk.dim(file)} ${chalk.dim('(exists)')}`);
  }
}

module.exports = { buildScaffoldPlan, applyScaffoldPlan, printPlanResults };
