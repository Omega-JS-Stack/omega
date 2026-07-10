const BaseCommand = require('./base-command');
const chalk = require('chalk').default;
const local = require('@omegajs/devkit/local');
const powertools = require('node-powertools');
const Npm = require('npm-api');
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
    // Link every declared @omegajs dependency (functions/package.json for
    // backend projects) to the local Omega monorepo — idempotent.
    const actions = await local.linkLocalPackages({
      dir: this.firebaseProjectPath,
      monorepoRoot: local.resolveMonorepoRoot(),
      logger: { log: (m) => this.log(m), warn: (m) => this.logWarning(m) },
    });

    if (actions.length === 0) {
      this.logWarning('No @omegajs dependencies declared in this project — nothing to link');
    }
  }

  async installLive() {
    // Check and update peer dependencies before installing
    await this.updatePeerDependencies();

    await this.uninstallPkg('@omegajs/backend');
    await this.installPkg('@omegajs/backend');
  }

  async updatePeerDependencies() {
    // Fetch latest @omegajs/backend package info from npm
    const latestBem = await this.getPackageInfo('@omegajs/backend');
    if (!latestBem || !latestBem.peerDependencies) {
      this.logWarning('Could not fetch @omegajs/backend peer dependencies, proceeding anyway...');
      return;
    }

    // Read project's package.json
    const projectPkgPath = `${this.firebaseProjectPath}/functions/package.json`;
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
    this.log(chalk.yellow('\nUpdating peer dependencies for @omegajs/backend...'));
    for (const dep of outdatedDeps) {
      const majorWarning = dep.isMajor ? chalk.red(' (major update)') : '';
      this.log(`  ${chalk.bold(dep.name)}: ${dep.installed} → ${dep.required}${majorWarning}`);
      await this.installPkg(dep.name, `@${dep.required}`);
    }

    this.log(chalk.green('Peer dependencies updated successfully!\n'));
  }

  async getPackageInfo(packageName) {
    const npm = new Npm();

    return new Promise((resolve) => {
      npm.repo(packageName)
        .package()
        .then((pkg) => {
          resolve(pkg);
        })
        .catch(() => {
          resolve(null);
        });
    });
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

  async uninstallPkg(name) {
    const command = `npm uninstall ${name}`;
    this.log('Running ', command);

    return await powertools.execute(command, { log: true })
      .catch((e) => {
        throw e;
      });
  }
}

module.exports = InstallCommand;