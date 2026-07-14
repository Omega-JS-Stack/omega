const path = require('path');
const BaseCommand = require('./base-command');

class McpCommand extends BaseCommand {
  async execute() {
    const self = this;
    const functionsDir = path.join(self.firebaseProjectPath, 'dist');

    // Load the .env cascade from the functions dir so OMEGA_ADMIN_KEY is available
    require('@omega.js/config').loadEnv(functionsDir);

    // Resolve the @omega.js/backend server URL
    const baseUrl = self.argv.url
      || process.env.OMEGA_BACKEND_URL
      || 'http://localhost:5002';

    // Resolve auth credentials
    const backendManagerKey = self.argv.key
      || process.env.OMEGA_ADMIN_KEY
      || '';
    const userToken = self.argv.token || '';

    const { startServer } = require('../../mcp/index.js');

    await startServer({
      baseUrl,
      backendManagerKey: userToken ? '' : backendManagerKey,
      userToken,
      cwd: functionsDir,
    });
  }
}

module.exports = McpCommand;
