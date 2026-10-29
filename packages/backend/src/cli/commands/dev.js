const EmulatorCommand = require('./emulator');
const { refuseWhenCustom, refuseWhenToolsMissing } = require('../utils/project-type');
const { runTargetChecks } = require('../utils/target-checks');

// The backend's dev loop, what the target's `start` script runs: the full
// emulator suite `omega emulator` boots. A custom-server backend has nothing to
// emulate, so its `start` is the brand's own server command.
class DevCommand extends EmulatorCommand {
  async execute() {
    if (refuseWhenCustom(this.main.firebaseProjectPath, 'dev')) return;
    if (refuseWhenToolsMissing(this.main.firebaseProjectPath, 'dev', ['java', 'firebase'])) return;

    // The brand's `start` is this verb, so the first boot audits the target here
    // (`omega emulator` stays check-free for the harness and the self-test),
    // offline as `omega test --offline`: a drift is reported, never deployed.
    this.attachVerbLog('dev');
    // The scaffold first: the checks audit a whole target, and a fresh brand's
    // firebase.json does not exist until ensureTarget writes it.
    await this.runEnsureTarget();
    this.main.argv.offline = true;
    this.ui.section('Target checks');
    await runTargetChecks(this.main);

    return super.execute();
  }
}

module.exports = DevCommand;
