const EmulatorCommand = require('./emulator');
const { refuseWhenCustom } = require('../utils/project-type');

// The backend's dev loop, what the target's `start` script runs: the full
// emulator suite `omega emulator` boots. A custom-server backend has nothing to
// emulate, so its `start` is the brand's own server command.
class DevCommand extends EmulatorCommand {
  async execute() {
    if (refuseWhenCustom(this.main.firebaseProjectPath, 'dev')) return;

    return super.execute();
  }
}

module.exports = DevCommand;
