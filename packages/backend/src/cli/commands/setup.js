const BaseCommand = require('./base-command');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const path = require('path');
const JSON5 = require('json5');
const fetch = require('wonderful-fetch');
// Namespaced: this class has its own loadConfig() method (CLI flags), which is unrelated
const omegaConfig = require('@omega.js/config');

// Rules-marker regex shared with the rules setup tests (used by getRulesFile)
const { omegaAllRulesRegex } = require('./setup-tests/helpers.js');

// The framework's own manifest — its `omega.functionsRuntime` is the pinned
// Cloud Functions runtime every consumer app inherits (SSOT with the .nvmrc
// lockstep in setup-tests/nvmrc-version.js). Deliberately decoupled from
// `engines.node`, which is the honest DEV floor (`>=22`): the cloud runtime
// is Firebase's to provide, the laptop only has to meet the floor.
const frameworkPackage = require('../../../package.json');

class SetupCommand extends BaseCommand {
  async execute() {
    const self = this.main;
    const ui = this.ui;

    // Load config
    await this.loadConfig();

    // Resolve retry limit from --retry flag (default 1 = no retry)
    const maxAttempts = Math.max(1, parseInt(self.argv.retry, 10) || 1);

    // Run setup, retrying up to maxAttempts times until all tests pass
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;

      if (maxAttempts > 1) {
        ui.section(`Attempt ${attempt}/${maxAttempts}`);
      }

      // Reset counters so each attempt starts fresh
      self.testCount = 0;
      self.testTotal = 0;
      self.warnCount = 0;

      await this.runSetup();

      const allPassed = self.testCount + self.warnCount === self.testTotal;
      if (allPassed) {
        return;
      }

      if (attempt < maxAttempts) {
        ui.status('warn', `Attempt ${attempt}/${maxAttempts} had failures — retrying…`);
      } else if (maxAttempts > 1) {
        ui.status('warn', `Reached retry limit (${maxAttempts}) — some checks still failing`);
      }
    }
  }

  async loadConfig() {
    const self = this.main;

    // Load the .env cascade from the app root (app ← brand ← company; the
    // staged functions/.env is a copy of the app layer, so this is the same
    // resolution the deployed runtime sees)
    require('@omega.js/config').loadEnv(self.firebaseProjectPath);
  }

  async runSetup() {
    const self = this.main;
    const ui = this.ui;

    // OMEGA-style banner. Replaces the old `---- RUNNING SETUP ---- ` line.
    ui.banner(`OMEGA Backend ${chalk.dim(`v${self.default.version}`)}`);

    // Fresh summary collector for this run (the test runner records into it and
    // prints it on a hard failure; we print it here on success).
    self.setupSummary = new ui.Summary().start();

    // Initial load — returns {} for missing files so scaffold checks can run.
    this.loadFiles();

    // The app manifest lives at the APP ROOT (src/dist pillar): scripts +
    // runtime deps in one package.json; functions/ is staged output. The CLI
    // entry normalizes a functions/ cwd up to the app root, so muscle-memory
    // `cd functions` invocations still land here.
    if (!hasContent(self.package)) {
      ui.status('fail', `Missing ${chalk.bold('package.json')} at the app root`);
      ui.note(`Run ${chalk.bold('npx omega setup')} from a backend app root (a package.json with the ${chalk.bold('@omega.js/backend')} dependency).`);
      process.exit(1);
    }

    // One unified scaffold pass: config files, package.json fixes, doc
    // defaults, then the STAGE (src/ → functions/) so every check below reads
    // the tree the runtime will. One reload afterwards picks up the final state.
    ui.section('Defaults');
    this.scaffoldConfigs();
    this.scaffoldPackageJson();
    this.copyDefaults();
    this.ensureStaged();
    this.loadFiles();

    // Clean up leftover trigger files + stale log files from older @omega.js/backend versions
    this.cleanupGeneratedArtifacts();

    // Load the rules files (reads from @omega.js/backend's own templates/, not consumer files)
    this.getRulesFile();
    // Version rides in the block's open marker: `// ========== OMEGA Rules (v6.2.0) ==========`
    self.default.rulesVersionRegex = new RegExp(`========== OMEGA Rules \\(v${self.default.version.replace(/\./g, '\\.')}\\) ==========`);

    // Resolve project info — safe now, scaffoldConfigs guarantees these exist.
    self.projectId = self.firebaseRC.projects.default;
    self.projectUrl = `https://console.firebase.google.com/project/${self.projectId}`;
    self.apiUrl = `https://api.${(self.omegaConfigJSON.brand?.url || '').replace(/^https?:\/\//, '')}`;

    // Divider-wrapped header with the project name + Firebase console link.
    const brandName = self.omegaConfigJSON.brand?.name || self.projectId;
    ui.header(brandName, { subtitle: self.projectUrl });
    ui.blank();
    ui.field('Project', self.projectId, { pad: 9 });
    ui.field('API', self.apiUrl, { pad: 9, valueColor: chalk.cyan });

    // Run all tests
    ui.section('Checks');
    await this.runTests();

    // Warn if using local @omega.js/backend
    const bemDep = self.package.dependencies?.['@omega.js/backend']
      || self.package.devDependencies?.['@omega.js/backend']
      || '';
    if (bemDep.includes('file:')) {
      ui.section('Notices');
      ui.status('warn', `Using the local ${chalk.bold('@omega.js/backend')} source (file: dependency)`, { level: 2 });
    }

    // Fetch stats
    ui.section('Stats');
    await this.fetchStats();

    // Everything passed (a hard failure would have exited via haltSetup). Print
    // the OMEGA-style summary block.
    self.setupSummary.print();

    // Notify parent if exists
    if (process.send) {
      process.send({
        sender: '@omega.js/backend',
        command: 'setup:complete',
        payload: {
          passed: self.testCount + self.warnCount === self.testTotal,
        }
      });
    }
  }

  getRulesFile() {
    const self = this.main;
    self.default.firestoreRulesWhole = (jetpack.read(path.resolve(`${__dirname}/../../../templates/firestore.rules`))).replace('(v0.0.0)', `(v${self.default.version})`);
    self.default.firestoreRulesCore = self.default.firestoreRulesWhole.match(omegaAllRulesRegex)[0];

    self.default.databaseRulesWhole = (jetpack.read(path.resolve(`${__dirname}/../../../templates/database.rules.json`))).replace('(v0.0.0)', `(v${self.default.version})`);
    self.default.databaseRulesCore = self.default.databaseRulesWhole.match(omegaAllRulesRegex)[0];
  }

  // Copy default files (src/defaults/**) into the consumer project root via the
  // shared devkit defaults engine (same engine as EM/BXM). The file map lives in
  // src/utils/scaffold-defaults.js: copy-if-missing for everything, marker-section
  // merge (Default = framework-owned, Custom = consumer-owned) for AGENTS.md,
  // .gitignore, and functions/.env on every setup.
  copyDefaults() {
    const self = this.main;
    const ui = this.ui;
    const defaultsDir = path.resolve(`${__dirname}/../../defaults`);

    if (!jetpack.exists(defaultsDir)) {
      // Defaults dir is optional — older @omega.js/backend versions didn't have one. If missing, skip silently.
      ui.note('No defaults to scaffold', 2);
      return;
    }

    const { scaffoldDefaults } = require('../../utils/scaffold-defaults.js');
    const result = scaffoldDefaults({
      outputDir: self.firebaseProjectPath,
      // ui owns the per-file output below; route engine errors through it too.
      logger: {
        log: () => {},
        warn: (m) => ui.status('warn', m, { level: 2 }),
        error: (m) => ui.status('warn', m, { level: 2 }),
      },
    });

    for (const file of result.written) {
      ui.status('add', `Copied ${chalk.cyan(file)}`, { level: 2 });
    }
    for (const file of result.merged) {
      ui.status('change', `Merged ${chalk.cyan(file)}`, { level: 2 });
    }

    if (result.written.length + result.merged.length === 0) {
      ui.note('All defaults up to date', 2);
    }
  }

  loadFiles() {
    const self = this.main;
    // THE app manifest (app root — scripts + runtime deps; the staged
    // functions/package.json derives from it at stage time)
    self.package = loadJSON(`${self.firebaseProjectPath}/package.json`);
    self.firebaseJSON = loadJSON(`${self.firebaseProjectPath}/firebase.json`);
    self.firebaseRC = loadJSON(`${self.firebaseProjectPath}/.firebaserc`);
    self.remoteconfigJSON = loadJSON(`${self.firebaseProjectPath}/functions/remoteconfig.template.json`);
    self.projectPackage = self.package;
    // Resolved through @omega.js/config (app ← brand root, no framework-defaults
    // layer). Throws on secrets/parse errors (setup IS the audit — hard
    // failures are correct here). The omega-config setup test validates the
    // resolved config against the shared schema (friction #5). A brand app
    // carries no file of its own — the brand root's config resolves alone.
    self.omegaConfigJSON = (omegaConfig.hasOmegaConfig(self.firebaseProjectPath)
      || omegaConfig.findBrandRoot(self.firebaseProjectPath))
      ? omegaConfig.loadConfig(self.firebaseProjectPath, 'backend').config
      : {};
    self.gitignore = jetpack.read(`${self.firebaseProjectPath}/.gitignore`) || '';
  }

  scaffoldPackageJson() {
    const self = this.main;
    const ui = this.ui;

    // engines.node on the APP manifest — the stage step carries it into the
    // derived functions/package.json (Cloud Functions runtime detection).
    // Derived from the FRAMEWORK's pinned runtime, never the ambient node:
    // setup must produce the same app under any shell (cp195 journey catch —
    // an ambient-24 setup stamped 24 against the v22/* .nvmrc and boot died
    // on the Manager.init version mismatch)
    if (!self.package.engines || !self.package.engines.node) {
      const nodeVer = String(parseInt(frameworkPackage.omega.functionsRuntime, 10));
      self.package.engines = self.package.engines || {};
      self.package.engines.node = nodeVer;
      jetpack.write(`${self.firebaseProjectPath}/package.json`, JSON.stringify(self.package, null, 2));
      ui.status('add', `Added ${chalk.cyan('engines.node')} = ${chalk.bold(nodeVer)} to package.json`, { level: 2 });
    }
  }

  scaffoldConfigs() {
    const self = this.main;
    const ui = this.ui;
    const templatesDir = path.resolve(`${__dirname}/../../../templates`);
    let touched = 0;

    // Config FIRST (friction #11: config → derived artifacts, so .firebaserc
    // below can read cloud.config.projectId). Inside a brand monorepo the app
    // carries NO omega.json5 at all — brand `targets.*` is the per-target home
    // (cp121c/cp122) and the stage step composes the runtime file. Standalone
    // consumers (no brand root above) get the full template at the APP ROOT —
    // the same escape hatch every other target uses.
    if (!omegaConfig.hasOmegaConfig(self.firebaseProjectPath)
      && !omegaConfig.findBrandRoot(self.firebaseProjectPath)) {
      jetpack.copy(path.join(templatesDir, 'config', 'omega.json5'), `${self.firebaseProjectPath}/config/omega.json5`);
      ui.status('add', `Created ${chalk.cyan('config/omega.json5')} (standalone app)`, { level: 2 });
      touched++;
    }

    // .firebaserc — DERIVED from the resolved config (else service account / env)
    const firebasercPath = `${self.firebaseProjectPath}/.firebaserc`;
    if (!hasContent(self.firebaseRC)) {
      const projectId = this.resolveProjectId();
      jetpack.write(firebasercPath, `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n`);
      ui.status('add', `Created ${chalk.cyan('.firebaserc')} (project: ${chalk.bold(projectId)})`, { level: 2 });
      touched++;
    }

    // firebase.json — scaffold or migrate
    const firebaseJsonPath = `${self.firebaseProjectPath}/firebase.json`;
    if (!hasContent(self.firebaseJSON)) {
      const templatePath = path.join(templatesDir, 'firebase.json');
      jetpack.copy(templatePath, firebaseJsonPath);
      ui.status('add', `Created ${chalk.cyan('firebase.json')}`, { level: 2 });
      touched++;
    } else {
      // Migrate legacy `functions` → `dist` (src/dist pillar): the functions
      // source and hosting public dir must point at the staged output tree.
      const fbJson = self.firebaseJSON;
      let fbDirty = false;
      const fnBlock = Array.isArray(fbJson.functions) ? fbJson.functions[0] : fbJson.functions;
      if (fnBlock && fnBlock.source === 'functions') {
        fnBlock.source = 'dist';
        fbDirty = true;
      }
      if (fbJson.hosting && fbJson.hosting.public === 'public') {
        fbJson.hosting.public = 'dist/public';
        fbDirty = true;
      }
      if (fbDirty) {
        jetpack.write(firebaseJsonPath, `${JSON.stringify(fbJson, null, 2)}\n`);
        ui.status('change', `Migrated ${chalk.cyan('firebase.json')} → functions source + hosting public → dist/`, { level: 2 });
        touched++;
      }
    }

    // src/index.js — the AUTHORED Cloud Functions entry (src/dist pillar);
    // the stage step mirrors it into dist/index.js
    const indexPath = `${self.firebaseProjectPath}/src/index.js`;
    if (!jetpack.exists(indexPath)) {
      const templatePath = path.join(templatesDir, 'index.js');
      jetpack.copy(templatePath, indexPath);
      ui.status('add', `Created ${chalk.cyan('src/index.js')}`, { level: 2 });
      touched++;
    }

    // database.rules.json — firebase.json references it and the emulator dies
    // ENOENT without it (friction #9). The template ships the v0.0.0-stamped
    // marker block; the rules checks stamp the live version.
    const databaseRulesPath = `${self.firebaseProjectPath}/database.rules.json`;
    if (!jetpack.exists(databaseRulesPath)) {
      jetpack.copy(path.join(templatesDir, 'database.rules.json'), databaseRulesPath);
      ui.status('add', `Created ${chalk.cyan('database.rules.json')}`, { level: 2 });
      touched++;
    }

    return touched;
  }

  resolveProjectId() {
    const self = this.main;

    // The config is the source of truth (friction #11): a wizard-seeded brand
    // carries cloud.config.projectId (demo-<id> convention) before any
    // artifact exists — .firebaserc derives from it, never the reverse.
    if (omegaConfig.hasOmegaConfig(self.firebaseProjectPath)) {
      try {
        const configured = omegaConfig.loadConfig(self.firebaseProjectPath, 'backend').config.cloud?.config?.projectId;
        if (configured) {
          return configured;
        }
      } catch (e) {
        // Unloadable config — the omega-config check reports it
      }
    }

    const saPath = `${self.firebaseProjectPath}/service-account.json`;
    if (jetpack.exists(saPath)) {
      try {
        const sa = JSON.parse(jetpack.read(saPath));
        if (sa.project_id) {
          return sa.project_id;
        }
      } catch (e) {
        // Fall through
      }
    }

    return process.env.GCLOUD_PROJECT || 'demo-project';
  }

  cleanupGeneratedArtifacts() {
    const self = this.main;

    // Remove the @omega.js/backend reload-trigger file (transient artifact from `npx omega watch`)
    const triggerFile = `${self.firebaseProjectPath}/functions/omega-reload-trigger.js`;
    if (jetpack.exists(triggerFile)) {
      jetpack.remove(triggerFile);
    }

    // Sweep stale firebase-tools debug logs + leftover @omega.js/backend logs from older
    // versions (pre-5.2.2 they lived in functions/; now in .temp/). Shared
    // implementation in base-command.js so emulator/serve boot also runs it.
    this.sweepStaleLogs();
  }

  async runTests() {
    const self = this.main;
    const testRegistry = require('./setup-tests');
    const helpers = require('./setup-tests/helpers');

    // Create test context
    const testContext = {
      main: self,
      package: self.package,
      packageJSON: self.packageJSON,
      gitignore: self.gitignore,
      hasContent: helpers.hasContent,
      isLocal: helpers.isLocal,
      loadJSON: helpers.loadJSON,
    };

    // Get all tests
    const tests = testRegistry.getTests(testContext);

    // Expose the total count so the per-check `[N]` prefix can right-align its
    // width (single- vs double-digit indices stay aligned).
    self.testTotalExpected = tests.length;

    // Run each test
    for (const test of tests) {
      await self.test(
        test.getName(),
        async () => {
          return await test.run();
        },
        async () => {
          return await test.fix();
        },
        { details: () => test.getWarning() },
      );
    }
  }

  async fetchStats() {
    const self = this.main;
    const url = `${self.apiUrl}/omega/admin/stats`;
    const statsFetchResult = await fetch(url, {
      method: 'GET',
      timeout: 30000,
      response: 'json',
      headers: {
        'omega-admin-key': process.env.OMEGA_ADMIN_KEY,
      },
    })
    .then(json => json)
    .catch(e => e);

    const ui = this.ui;
    if (statsFetchResult instanceof Error) {
      if (statsFetchResult.message.includes('network timeout')) {
        ui.status('skip', 'Skipped stats fetch', { detail: 'network timeout', level: 2 });
      } else {
        ui.status('warn', 'Could not fetch stats endpoint', { detail: statsFetchResult.message, level: 2 });
      }
    } else {
      ui.status('pass', 'Stats fetched/created', { level: 2 });
    }
  }
}

// Helper functions
function loadJSON(path) {
  const contents = jetpack.read(path);
  if (!contents) {
    return {};
  }
  return JSON5.parse(contents);
}

function hasContent(object) {
  return Object.keys(object).length > 0;
}

module.exports = SetupCommand;
