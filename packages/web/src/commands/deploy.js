/**
 * `omega deploy` — production build, then commit-and-push via `npu sync`
 * (CI builds and publishes from the pushed commit). Refuses to deploy with
 * local `file:` packages installed. (UJM deploy.js parity.)
 */
const path = require('node:path');
const { execSync } = require('node:child_process');
const Logger = require('@omegajs/devkit/logger');

const logger = new Logger('omega:deploy');

module.exports = async function (options) {
  const project = require(path.join(process.cwd(), 'package.json'));

  // Check for local packages
  const allDeps = JSON.stringify(project.dependencies || {}) + JSON.stringify(project.devDependencies || {});
  if (allDeps.includes('file:')) {
    throw new Error('Please remove local packages before deploying!');
  }

  logger.log('Building...');
  execSync('npm run build', { stdio: 'inherit' });

  logger.log('Deploying...');
  execSync(`npu sync --message='Deploy'`, { stdio: 'inherit' });
};
