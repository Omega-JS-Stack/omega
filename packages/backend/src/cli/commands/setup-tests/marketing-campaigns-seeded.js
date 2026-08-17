const BaseTest = require('./base-test');
const chalk = require('chalk').default;
const _ = require('lodash');
const { buildSeedCampaigns } = require('./helpers/seed-campaigns');

class MarketingCampaignsSeededTest extends BaseTest {
  getName() {
    return 'marketing campaigns seeded in Firestore';
  }

  getWarning() {
    // Under --offline the opt-in is overridden, so "pass the flag" would be
    // the wrong remedy — name the flag that suppressed the write instead.
    if (this.isOffline) {
      return [
        'live campaign seeding skipped (--offline) — re-run `npx omega setup --seed-campaigns` without --offline to seed/enforce',
      ];
    }

    return [
      'live campaign seeding is opt-in — run `npx omega setup --seed-campaigns` to seed/enforce',
    ];
  }

  async run() {
    // demo-* projects are emulator-only — live Firestore doesn't exist and the
    // generated fake service account authenticates nowhere (the first .get()
    // threw gRPC 16 UNAUTHENTICATED and halted setup — friction #8's class).
    // Emulator runs seed campaigns through the shared seed module at boot.
    if (this.isDemoProject) {
      console.log(chalk.dim(`  demo-* project (${this.self.projectId}) — live campaign seeding skipped (emulator seeds on boot)`));
      return true;
    }

    const admin = this._getAdmin();

    if (!admin) {
      return true; // Can't connect — skip gracefully
    }

    const seeds = buildSeedCampaigns();

    for (const seed of seeds) {
      const doc = await admin.firestore().doc(`marketing-campaigns/${seed.id}`).get();

      // Doc doesn't exist → fail
      if (!doc.exists) {
        return this._driftVerdict();
      }

      // Check enforced fields + missing defaults
      const data = doc.data();

      for (const [path, expected] of Object.entries(seed.enforced)) {
        const actual = _.get(data, path);

        if (!_.isEqual(actual, expected)) {
          return this._driftVerdict();
        }
      }

      // Check for missing fields that should exist from seed
      if (hasMissingFields(data, seed.doc)) {
        return this._driftVerdict();
      }
    }

    return true;
  }

  async fix() {
    if (this.isDemoProject) {
      return; // run() never fails demo projects; never touch live Firestore here
    }

    // Belt for a future direct caller: run() already warns instead of failing
    // when the flag is absent, so the runner can never reach this fix.
    if (!this._seedingRequested()) {
      return;
    }

    const admin = this._getAdmin();

    if (!admin) {
      console.log(chalk.yellow('  ⚠ No Firebase connection — skipping campaign seeding'));
      console.log(chalk.yellow('    Run from a project with service-account.json to seed'));
      return;
    }

    const seeds = buildSeedCampaigns();

    for (const seed of seeds) {
      const docRef = admin.firestore().doc(`marketing-campaigns/${seed.id}`);
      const doc = await docRef.get();

      // Doc doesn't exist → create it
      if (!doc.exists) {
        await docRef.set(seed.doc);
        console.log(chalk.green(`  + Created ${chalk.cyan(seed.id)}: ${seed.doc.settings.name}`));
        continue;
      }

      // Doc exists → fill missing defaults + enforce required fields
      const data = doc.data();
      const updates = {};

      // Fill missing fields from seed defaults (never overwrite existing values)
      fillMissing(data, seed.doc, updates, '');

      // Enforce required fields (always overwrite to match seed)
      for (const [path, expected] of Object.entries(seed.enforced)) {
        const actual = _.get(data, path);

        if (!_.isEqual(actual, expected)) {
          _.set(updates, path, expected);
          console.log(chalk.yellow(`  ↻ ${seed.id}: ${chalk.cyan(path)} ${chalk.dim(JSON.stringify(actual))} → ${chalk.bold(JSON.stringify(expected))}`));
        }
      }

      if (Object.keys(updates).length) {
        updates.metadata = {
          updated: {
            timestamp: new Date().toISOString(),
            timestampUNIX: Math.round(Date.now() / 1000),
          },
        };

        await docRef.set(updates, { merge: true });
      } else {
        console.log(chalk.dim(`  ✓ ${seed.id} — all enforced fields correct`));
      }
    }
  }

  /**
   * The verdict for a missing/drifted seed. Reads run on every live project,
   * but writing 5 docs into a REAL project's Firestore is opt-in: without the
   * flag a drift warns (non-blocking, and the runner never fixes a 'warn'),
   * with the flag it fails so fix() seeds/enforces.
   */
  _driftVerdict() {
    return this._seedingRequested() ? false : 'warn';
  }

  /**
   * True when the run opted into live seeding with `--seed-campaigns`.
   * `--offline` overrides the opt-in: it promises NO live mutations for the
   * whole run, and fix() writes real Firestore docs (#284).
   */
  _seedingRequested() {
    const argv = this.self.argv || {};

    if (this.isOffline) {
      return false;
    }

    return !!(argv.seedCampaigns || argv['seed-campaigns']);
  }

  _getAdmin() {
    try {
      const { initFirebase } = require('../firebase-init');
      const { admin } = initFirebase({
        firebaseProjectPath: this.self.firebaseProjectPath,
        emulator: false,
      });

      return admin;
    } catch (e) {
      console.log(chalk.dim(`  (firebase-init failed: ${e.message})`));
      return null;
    }
  }
}

/**
 * Check if the live doc is missing any fields defined in the seed.
 */
function hasMissingFields(live, seed, prefix) {
  for (const [key, seedValue] of Object.entries(seed)) {
    if (key === 'metadata') {
      continue;
    }

    const path = prefix ? `${prefix}.${key}` : key;
    const liveValue = _.get(live, path);

    if (liveValue === undefined) {
      return true;
    }

    if (_.isPlainObject(seedValue) && _.isPlainObject(liveValue)) {
      if (hasMissingFields(live, seedValue, path)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Recursively fill missing fields from seed into updates.
 * Only sets fields that don't exist in the live doc — never overwrites.
 * Skips metadata (managed separately).
 */
function fillMissing(live, seed, updates, prefix) {
  for (const [key, seedValue] of Object.entries(seed)) {
    if (key === 'metadata') {
      continue;
    }

    const path = prefix ? `${prefix}.${key}` : key;
    const liveValue = _.get(live, path);

    // If live doc is missing this field entirely, set it from seed
    if (liveValue === undefined) {
      _.set(updates, path, seedValue);
      console.log(chalk.blue(`  + ${path}: ${chalk.dim('(missing)')} → ${chalk.bold(JSON.stringify(seedValue).slice(0, 80))}`));
      continue;
    }

    // If both are plain objects, recurse to check nested fields
    if (_.isPlainObject(seedValue) && _.isPlainObject(liveValue)) {
      fillMissing(live, seedValue, updates, path);
    }
  }
}

module.exports = MarketingCampaignsSeededTest;
