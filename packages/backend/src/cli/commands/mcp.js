const path = require('path');
const BaseCommand = require('./base-command');

class McpCommand extends BaseCommand {
  async execute() {
    const self = this;

    // dist/ is staged output — a fresh clone has none; the MCP server reads
    // its config from the staged tree (same view as the runtime). `development`
    // is PINNED (#586): mcp is a LOCAL lane like emulator/serve, and the stage
    // and the read below must name the same environment or this process would
    // read an overlay its own stage never composed.
    this.ensureStaged({ environment: 'development' });
    const functionsDir = path.join(self.firebaseProjectPath, 'dist');

    // Load the .env cascade so OMEGA_ADMIN_KEY is available
    require('@omega.js/config').loadEnv(functionsDir, { environment: 'development' });

    // Resolve the @omega.js/backend server URL
    const baseUrl = self.argv.url
      || process.env.OMEGA_BACKEND_URL
      || 'http://localhost:5002';

    // Resolve auth credentials
    const adminKey = self.argv.key
      || process.env.OMEGA_ADMIN_KEY
      || '';
    const userToken = self.argv.token || '';

    const { startServer } = require('../../mcp/index.js');

    await startServer({
      baseUrl,
      adminKey: userToken ? '' : adminKey,
      userToken,
      cwd: functionsDir,
    });
  }
}

module.exports = McpCommand;
