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

    // Load the .env cascade from the functions dir
    require('@omega.js/config').loadEnv(`${self.firebaseProjectPath}/functions`);
  }

  async runSetup() {
    const self = this.main;
    const ui = this.ui;
    let cwd = jetpack.cwd();

    // OMEGA-style banner. Replaces the old `---- RUNNING SETUP ---- ` line.
    ui.banner(`OMEGA Backend ${chalk.dim(`v${self.default.version}`)}`);

    // Fresh summary collector for this run (the test runner records into it and
    // prints it on a hard failure; we print it here on success).
    self.setupSummary = new ui.Summary().start();

    // Initial load — returns {} for missing files so scaffold checks can run.
    this.loadFiles();

    // Check if package exists
    if (!hasContent(self.package)) {
      ui.status('fail', `Missing ${chalk.bold('functions/package.json')}`);
      ui.note(`Run ${chalk.bold('npx omega setup')} from inside the ${chalk.bold('functions')} folder of a Firebase project.`);
      process.exit(1);
    }

    // Check if we're running from the functions folder
    if (!cwd.endsWith('functions') && !cwd.endsWith('functions/')) {
      ui.status('fail', `Wrong directory`);
      ui.note(`Run ${chalk.bold('npx omega setup')} from the ${chalk.bold('functions')} folder. Try ${chalk.bold('cd functions')} first.`);
      process.exit(1);
    }

    // One unified scaffold pass: config files, package.json fixes, doc defaults.
    // Everything that creates/fixes files goes here, BEFORE any code reads from
    // them. One reload afterwards picks up the final state.
    ui.section('Defaults');
    this.scaffoldConfigs();
    this.scaffoldPackageJson();
    this.copyDefaults();
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
  // merge (Default = framework-owned, Custom = consumer-owned) for CLAUDE.md,
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
    self.package = loadJSON(`${self.firebaseProjectPath}/functions/package.json`);
    self.firebaseJSON = loadJSON(`${self.firebaseProjectPath}/firebase.json`);
    self.firebaseRC = loadJSON(`${self.firebaseProjectPath}/.firebaserc`);
    self.remoteconfigJSON = loadJSON(`${self.firebaseProjectPath}/functions/remoteconfig.template.json`);
    self.projectPackage = loadJSON(`${self.firebaseProjectPath}/package.json`);
    // Resolved through @omega.js/config (app ← brand root, no framework-defaults
    // layer). Throws on secrets/parse errors (setup IS the audit — hard
    // failures are correct here). The omega-config setup test validates the
    // resolved config against the shared schema (friction #5).
    self.omegaConfigJSON = omegaConfig.hasOmegaConfig(self.firebaseProjectPath)
      ? omegaConfig.loadConfig(self.firebaseProjectPath, 'backend').config
      : {};
    self.gitignore = jetpack.read(`${self.firebaseProjectPath}/.gitignore`) || '';
  }

  scaffoldPackageJson() {
    const self = this.main;
    const ui = this.ui;

    if (!self.package.engines || !self.package.engines.node) {
      const nodeVer = String(parseInt(process.versions.node, 10));
      self.package.engines = self.package.engines || {};
      self.package.engines.node = nodeVer;
      jetpack.write(`${self.firebaseProjectPath}/functions/package.json`, JSON.stringify(self.package, null, 2));
      ui.status('add', `Added ${chalk.cyan('engines.node')} = ${chalk.bold(nodeVer)} to package.json`, { level: 2 });
    }
  }

  scaffoldConfigs() {
    const self = this.main;
    const ui = this.ui;
    const templatesDir = path.resolve(`${__dirname}/../../../templates`);
    let touched = 0;

    // config/omega.json5 FIRST — layer-aware (dogfood friction #1): inside a
    // brand monorepo the app config is TARGETS-ONLY (the brand root owns the
    // shared sections; a full template here would shadow them). Standalone
    // consumers get the full template. Seeding before .firebaserc lets
    // resolveProjectId() read the brand's cloud.config.projectId (friction #11:
    // config → derived artifacts).
    const omegaConfigPath = `${self.firebaseProjectPath}/functions/config/omega.json5`;
    if (!omegaConfig.hasOmegaConfig(self.firebaseProjectPath)) {
      if (omegaConfig.resolveSeedMode(self.firebaseProjectPath).standalone) {
        jetpack.copy(path.join(templatesDir, 'config', 'omega.json5'), omegaConfigPath);
      } else {
        jetpack.write(omegaConfigPath, omegaConfig.renderBrandAppSeed('backend'));
      }
      ui.status('add', `Created ${chalk.cyan('functions/config/omega.json5')}`, { level: 2 });
      touched++;
    }

    // .firebaserc — DERIVED from the resolved config (else service account / env)
    const firebasercPath = `${self.firebaseProjectPath}/.firebaserc`;
    if (!hasContent(self.firebaseRC)) {
      const projectId = this.resolveProjectId();
      jetpack.write(firebasercPath, JSON.stringify({ projects: { default: projectId } }, null, 2) + '\n');
      ui.status('add', `Created ${chalk.cyan('.firebaserc')} (project: ${chalk.bold(projectId)})`, { level: 2 });
      touched++;
    }

    // firebase.json
    const firebaseJsonPath = `${self.firebaseProjectPath}/firebase.json`;
    if (!hasContent(self.firebaseJSON)) {
      const templatePath = path.join(templatesDir, 'firebase.json');
      jetpack.copy(templatePath, firebaseJsonPath);
      ui.status('add', `Created ${chalk.cyan('firebase.json')}`, { level: 2 });
      touched++;
    }

    // index.js — entry point for Cloud Functions
    const indexPath = `${self.firebaseProjectPath}/functions/index.js`;
    if (!jetpack.exists(indexPath)) {
      const templatePath = path.join(templatesDir, 'index.js');
      jetpack.copy(templatePath, indexPath);
      ui.status('add', `Created ${chalk.cyan('functions/index.js')}`, { level: 2 });
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

    const saPath = `${self.firebaseProjectPath}/functions/service-account.json`;
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
      query: {
        backendManagerKey: process.env.OMEGA_ADMIN_KEY,
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
