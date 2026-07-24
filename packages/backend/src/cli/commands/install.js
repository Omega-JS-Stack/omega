const BaseCommand = require('./base-command');
const chalk = require('chalk').default;
const local = require('@omega.js/devkit/local');
const { getPackageManifest } = require('@omega.js/devkit/npm-registry');
const jetpack = require('fs-jetpack');
const wonderfulVersion = require('wonderful-version');
const { safeInstall } = require('../utils/safe-install');

class InstallCommand extends BaseCommand {
  async execute(type) {
    if (['local', 'l', 'dev', 'd', 'development'].includes(type)) {
      await this.installLocal();
    } else if (['live', 'prod', 'p', 'production'].includes(type)) {
      await this.installLive();
    }
  }

  async installLocal() {
    // Link every declared @omega.js dependency (functions/package.json for
    // backend projects) to the local Omega monorepo — idempotent.
    const actions = await local.linkLocalPackages({
      dir: this.firebaseProjectPath,
      monorepoRoot: local.resolveMonorepoRoot(),
      logger: { log: (m) => this.log(m), warn: (m) => this.logWarning(m) },
    });

    if (actions.length === 0) {
      this.logWarning('No @omega.js dependencies declared in this project — nothing to link');
    }
  }

  async installLive() {
    // Check and update peer dependencies before installing
    await this.updatePeerDependencies();

    // The publish-day inverse of `i local`: flip every file: spec in the
    // brand tree to ^<linked version>, then one registry install
    const actions = await local.restoreRegistrySpecs({
      dir: this.firebaseProjectPath,
      logger: { log: (m) => this.log(m), warn: (m) => this.logWarning(m) },
    });
    const flipped = actions.filter((action) => action.action === 'flip').length;
    this.log(flipped > 0
      ? `Production installation complete (${flipped} spec(s) restored to registry ranges).`
      : 'Already on registry specs — nothing to flip.');
  }

  async updatePeerDependencies() {
    // Fetch latest @omega.js/backend package info from npm
    const latestBem = await this.getPackageInfo('@omega.js/backend');
    if (!latestBem || !latestBem.peerDependencies) {
      this.logWarning('Could not fetch @omega.js/backend peer dependencies, proceeding anyway...');
      return;
    }

    // Read the app manifest (APP ROOT under the src/dist pillar — runtime deps
    // live there; functions/package.json is derived output)
    const projectPkgPath = `${this.firebaseProjectPath}/package.json`;
    const projectPkg = jetpack.read(projectPkgPath, 'json');
    if (!projectPkg || !projectPkg.dependencies) {
      this.logWarning('Could not read project package.json, proceeding anyway...');
      return;
    }

    // Check each peer dependency
    const peerDeps = ['firebase-admin', 'firebase-functions'];
    const outdatedDeps = [];

    for (const dep of peerDeps) {
      const required = latestBem.peerDependencies[dep];
      const installed = projectPkg.dependencies[dep];

      if (!required || !installed) {
        continue;
      }

      // Check if installed version meets the requirement
      const meetsRequirement = wonderfulVersion.is(installed, '>=', required);
      const levelDifference = wonderfulVersion.levelDifference(required, installed);

      if (!meetsRequirement) {
        outdatedDeps.push({
          name: dep,
          installed,
          required,
          isMajor: levelDifference === 'major',
        });
      }
    }

    // If no outdated deps, we're good
    if (outdatedDeps.length === 0) {
      return;
    }

    // Log and update each dependency
    this.log(chalk.yellow('\nUpdating peer dependencies for @omega.js/backend...'));
    for (const dep of outdatedDeps) {
      const majorWarning = dep.isMajor ? chalk.red(' (major update)') : '';
      this.log(`  ${chalk.bold(dep.name)}: ${dep.installed} → ${dep.required}${majorWarning}`);
      await this.installPkg(dep.name, `@${dep.required}`);
    }

    this.log(chalk.green('Peer dependencies updated successfully!\n'));
  }

  async getPackageInfo(packageName) {
    return getPackageManifest(packageName);
  }

  async installPkg(name, version, type) {
    let v;
    let t;
    
    if (typeof name === 'string' && name.startsWith('npm install')) {
      // Full npm install command passed
      const command = name;
      this.log('Running ', command);
      
      return await safeInstall(command, { log: true })
        .catch((e) => {
          throw e;
        });
    }

    if (name.indexOf('file:') > -1) {
      v = '';
    } else if (!version) {
      v = '@latest';
    } else {
      v = version;
    }

    if (!type) {
      t = '';
    } else if (type === 'dev' || type === '--save-dev') {
      t = ' --save-dev';
    }

    const command = `npm i ${name}${v}${t}`;
    this.log('Running ', command);

    return await safeInstall(command, { log: true })
      .catch((e) => {
        throw e;
      });
  }

}

module.exports = InstallCommand;
