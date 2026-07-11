const BaseTest = require('./base-test');
const path = require('path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const _ = require('lodash');

// Default emulator ports - SSOT for fallback values
const DEFAULT_EMULATOR_PORTS = {
  auth: 9099,
  functions: 5001,
  firestore: 8080,
  database: 9000,
  hosting: 5002,
  storage: 9199,
  pubsub: 8085,
  ui: 4050,
};

/**
 * Load a project's emulator ports from firebase.json, falling back to the
 * classic defaults. ONE home (N7) — emulator.js, test.js, and
 * firebase-init.js import this instead of carrying their own copies.
 * @param {string} projectDir - Firebase project directory.
 * @returns {object} Name → port map.
 */
function loadEmulatorPorts(projectDir) {
  const emulatorPorts = { ...DEFAULT_EMULATOR_PORTS };
  const firebaseJsonPath = path.join(projectDir, 'firebase.json');

  if (jetpack.exists(firebaseJsonPath)) {
    try {
      const firebaseConfig = JSON5.parse(jetpack.read(firebaseJsonPath));
      if (firebaseConfig.emulators) {
        for (const name of Object.keys(DEFAULT_EMULATOR_PORTS)) {
          emulatorPorts[name] = firebaseConfig.emulators[name]?.port || DEFAULT_EMULATOR_PORTS[name];
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not parse firebase.json: ${error.message}`);
    }
  }

  return emulatorPorts;
}

const REQUIRED_EMULATORS = {
  auth: { port: DEFAULT_EMULATOR_PORTS.auth },
  functions: { port: DEFAULT_EMULATOR_PORTS.functions },
  firestore: { port: DEFAULT_EMULATOR_PORTS.firestore },
  database: { port: DEFAULT_EMULATOR_PORTS.database },
  hosting: { port: DEFAULT_EMULATOR_PORTS.hosting },
  storage: { port: DEFAULT_EMULATOR_PORTS.storage },
  pubsub: { port: DEFAULT_EMULATOR_PORTS.pubsub },
  ui: { enabled: true, port: DEFAULT_EMULATOR_PORTS.ui },
};

class EmulatorConfigTest extends BaseTest {
  getName() {
    return 'emulator config in firebase.json';
  }

  async run() {
    const emulators = this.self.firebaseJSON?.emulators;

    if (!emulators) {
      return false;
    }

    // Check each required emulator
    for (const [name, config] of Object.entries(REQUIRED_EMULATORS)) {
      if (!emulators[name]) {
        return false;
      }

      // Check all required properties
      for (const [key, value] of Object.entries(config)) {
        if (emulators[name][key] !== value) {
          return false;
        }
      }
    }

    // Check singleProjectMode
    if (emulators.singleProjectMode !== true) {
      return false;
    }

    return true;
  }

  async fix() {
    // Set each emulator config
    for (const [name, config] of Object.entries(REQUIRED_EMULATORS)) {
      for (const [key, value] of Object.entries(config)) {
        _.set(this.self.firebaseJSON, `emulators.${name}.${key}`, value);
      }
    }

    // Set singleProjectMode
    _.set(this.self.firebaseJSON, 'emulators.singleProjectMode', true);

    // Write updated config
    jetpack.write(`${this.self.firebaseProjectPath}/firebase.json`, JSON.stringify(this.self.firebaseJSON, null, 2));
  }
}

module.exports = EmulatorConfigTest;
module.exports.DEFAULT_EMULATOR_PORTS = DEFAULT_EMULATOR_PORTS;
module.exports.loadEmulatorPorts = loadEmulatorPorts;
