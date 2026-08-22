const BaseTest = require('./base-test');
const chalk = require('chalk').default;

/**
 * Local Node vs the pinned Cloud Functions runtime.
 *
 * The runtime pin (framework `omega.functionsRuntime`) is what Firebase runs
 * in the cloud; the laptop only has to meet the framework's dev floor
 * (`engines.node >=22`). Local OLDER than the runtime warns — the emulator
 * can't faithfully run runtime-era code. Local NEWER is fine (deploys are
 * unaffected — Firebase provides the runtime) and gets a dim parity note.
 * A target pin drifted from the framework runtime is healed by fix().
 */
class NodeVersionTest extends BaseTest {
  getName() {
    return `Node.js vs pinned Cloud Functions runtime (v${this.context.packageJSON.omega.functionsRuntime})`;
  }

  async run() {
    const runtimeMajor = parseInt(this.context.packageJSON.omega.functionsRuntime, 10);
    const targetPin = parseInt((this.context.package.engines || {}).node, 10);
    const localVer = process.versions.node;
    const localMajor = parseInt(localVer, 10);

    // #15: a wrong RUNNING Node no longer halts the whole setup — the
    // remaining checks complete and this lands in the summary as a warning
    // (manage runs spawn setup under the target's own .nvmrc Node, so this
    // fires mostly in standalone shells).
    if (localMajor < runtimeMajor) {
      this._warning = `running Node ${localVer} but the pinned Cloud Functions runtime is ${runtimeMajor} — use Node >=${runtimeMajor} (nvm users: ${chalk.bold(`nvm use ${runtimeMajor}`)})`;
      return 'warn';
    }

    if (localMajor > runtimeMajor) {
      console.log(chalk.dim(`  local Node ${localVer} > functions runtime ${runtimeMajor} — deploys unaffected (Firebase provides the runtime); use Node ${runtimeMajor} locally for exact emulator parity`));
    }

    // Target pin must match the framework's runtime — drift (or a missing pin)
    // heals via fix(), keeping the staged functions manifest correct.
    return targetPin === runtimeMajor;
  }

  getWarning() {
    return this._warning ? [this._warning] : [];
  }

  async fix() {
    const runtime = String(parseInt(this.context.packageJSON.omega.functionsRuntime, 10));

    const manifest = this.readTargetManifest();
    manifest.engines = manifest.engines || {};
    manifest.engines.node = runtime;
    this.writeTargetManifest();
    this.restage();

    console.log(chalk.yellow(`engines.node restamped to ${runtime} (the pinned Cloud Functions runtime)`));
  }
}

module.exports = NodeVersionTest;
