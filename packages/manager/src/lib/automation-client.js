/**
 * Automation client — drives the companion Chrome extension (extension/)
 * over its WebSocket protocol. The manager side is the SERVER: it listens
 * on the port the extension auto-connects to (ws://localhost:9876,
 * reconnecting every 5s), then sends OMEGA_AUTOMATE commands and awaits
 * OMEGA_AUTOMATE_RESULT responses by correlation id. The extension turns
 * the commands into trusted CDP input events (chrome.debugger), so the
 * automated pages can't tell a human from the manager.
 *
 * Port and timeouts are constructor-injectable (tests bind ephemeral
 * ports; OMEGA_EXTENSION_PORT overrides the default when 9876 is taken —
 * the extension side must be pointed at the same port).
 *
 * Usage:
 *   const client = new AutomationClient();
 *   await client.connect();
 *   await client.navigate('https://example.com');
 *   await client.click('#submit');
 *   await client.type('input', 'hello');
 *   const result = await client.evaluate('document.title');
 *   await client.disconnect();
 */
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 9876;
const CONNECT_TIMEOUT = 15000;
const COMMAND_TIMEOUT = 30000;

let cmdCounter = 0;

/** The port the extension protocol runs on (env-overridable). */
function resolveExtensionPort() {
  return Number(process.env.OMEGA_EXTENSION_PORT) || DEFAULT_PORT;
}

class AutomationClient {
  constructor(options = {}) {
    this.port = options.port || resolveExtensionPort();
    this.connectTimeout = options.connectTimeout || CONNECT_TIMEOUT;
    this.commandTimeout = options.commandTimeout || COMMAND_TIMEOUT;
    this.wss = null;
    this.ws = null;
    this.pending = new Map(); // id → { resolve, reject, timeout }
  }

  /**
   * Start the WebSocket server and wait for the extension to connect.
   */
  async connect() {
    if (this.ws) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port });

      const timeout = setTimeout(() => {
        this.wss.close();
        this.wss = null;
        reject(new Error('Extension did not connect (timeout). Make sure the Omega extension is installed and enabled.'));
      }, this.connectTimeout);

      this.wss.on('error', (error) => {
        clearTimeout(timeout);
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} already in use`));
        } else {
          reject(error);
        }
      });

      this.wss.on('connection', (ws) => {
        clearTimeout(timeout);
        this.ws = ws;

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleResponse(msg);
          } catch {
            // Ignore parse errors
          }
        });

        ws.on('close', () => {
          this.ws = null;
          // Reject all pending commands
          for (const [id, entry] of this.pending) {
            clearTimeout(entry.timeout);
            entry.reject(new Error('Extension disconnected'));
            this.pending.delete(id);
          }
        });

        resolve();
      });
    });
  }

  /**
   * Disconnect and clean up.
   */
  async disconnect() {
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      await new Promise((resolve) => this.wss.close(resolve));
      this.wss = null;
    }
  }

  /**
   * Send a single automation command and wait for the result.
   */
  async send(command, params = {}, target = {}) {
    if (!this.ws) {
      throw new Error('Not connected to extension');
    }

    const id = `cmd_${++cmdCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command "${command}" timed out after ${this.commandTimeout}ms`));
      }, this.commandTimeout);

      this.pending.set(id, { resolve, reject, timeout });

      this.ws.send(JSON.stringify({
        type: 'OMEGA_AUTOMATE',
        id,
        command,
        params,
        target,
      }));
    });
  }

  /**
   * Handle a response message from the extension.
   */
  _handleResponse(msg) {
    if (msg.type === 'OMEGA_AUTOMATE_PROGRESS') {
      // Progress events during sequences — informational only
      return;
    }

    if (msg.type !== 'OMEGA_AUTOMATE_RESULT') {
      return;
    }

    const entry = this.pending.get(msg.id);
    if (!entry) {
      return;
    }

    clearTimeout(entry.timeout);
    this.pending.delete(msg.id);

    if (msg.success) {
      entry.resolve(msg.result);
    } else {
      const err = new Error(msg.error?.message || 'Automation command failed');
      err.code = msg.error?.code;
      entry.reject(err);
    }
  }

  // =========================================================================
  // Convenience methods
  // =========================================================================

  /** Navigate to a URL (opens a new tab when target.create is true). */
  async navigate(url, target = {}) {
    return this.send('navigate', { url }, target);
  }

  /** Click an element by CSS selector. */
  async click(selector, options = {}) {
    return this.send('click', { selector, ...options });
  }

  /** Type text into an element with trusted key events. */
  async type(selector, text, options = {}) {
    return this.send('type', { selector, text, ...options });
  }

  /** Read DOM content. */
  async read(params = {}) {
    return this.send('read', params);
  }

  /** Wait for an element, condition, or delay. */
  async wait(params = {}) {
    return this.send('wait', params);
  }

  /** Evaluate arbitrary JavaScript in the page context. */
  async evaluate(expression) {
    return this.send('evaluate', { expression });
  }
}

module.exports = { AutomationClient, resolveExtensionPort, DEFAULT_PORT };
