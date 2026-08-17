const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const _ = require('lodash');
const powertools = require('node-powertools');

class FirestoreIndexesSyncedTest extends BaseTest {
  getName() {
    return 'firestore indexes synced';
  }

  getWarning() {
    return [
      'live index deploy skipped (--offline) — the drift above is reported only; re-run `npx omega setup` without --offline to deploy',
    ];
  }

  async run() {
    const self = this.self;
    const tempPath = '_firestore.indexes.json';

    // demo-* projects are emulator-only — there is no live Firestore to sync
    // with. The old behavior hit the live API, got a 403, and the shell
    // redirect wrote the ERROR TEXT into the json file (friction #8).
    if (this.isDemoProject) {
      console.log(chalk.dim(`  demo-* project (${self.projectId}) — live index sync skipped (emulator-only)`));
      return true;
    }

    const IndexesCommand = require('../indexes');
    const indexesCmd = new IndexesCommand(self);

    const liveIndexes = await indexesCmd.get(tempPath, false);

    const localIndexes_exists = jetpack.exists(`${self.firebaseProjectPath}/firestore.indexes.json`);
    let localIndexes;
    if (localIndexes_exists) {
      localIndexes = require(`${self.firebaseProjectPath}/firestore.indexes.json`);
    }

    // Firebase adds implicit properties to live indexes (__name__ fields, density, etc.)
    // and returns them in a different order. Normalize before comparing.
    const normalizeIndexes = (indexes) => {
      if (!indexes?.indexes) {
        return indexes;
      }
      return {
        ...indexes,
        indexes: _.sortBy(indexes.indexes.map(idx => {
          const { density, ...rest } = idx;
          return {
            ...rest,
            fields: (rest.fields || []).filter(f => f.fieldPath !== '__name__'),
          };
        }), idx => `${idx.collectionGroup}:${(idx.fields || []).map(f => f.fieldPath).join(',')}`),
      };
    };

    const equal = _.isEqual(normalizeIndexes(liveIndexes), normalizeIndexes(localIndexes));

    jetpack.remove(`${self.firebaseProjectPath}/${tempPath}`);

    if (!equal && localIndexes_exists) {
      // Log what differs so the user can see why (use stripped versions for accurate comparison)
      const strippedLocal = normalizeIndexes(localIndexes);
      const strippedLive = normalizeIndexes(liveIndexes);
      const localOnly = _.differenceWith(strippedLocal?.indexes || [], strippedLive?.indexes || [], _.isEqual);
      const liveOnly = _.differenceWith(strippedLive?.indexes || [], strippedLocal?.indexes || [], _.isEqual);

      if (localOnly.length > 0) {
        console.log(chalk.yellow(`  Indexes in local but not live:`));
        for (const idx of localOnly) {
          console.log(chalk.gray(`    - ${idx.collectionGroup} [${(idx.fields || []).map(f => `${f.fieldPath} ${f.order || f.arrayConfig}`).join(', ')}]`));
        }
      }
      if (liveOnly.length > 0) {
        console.log(chalk.yellow(`  Indexes in live but not local:`));
        for (const idx of liveOnly) {
          console.log(chalk.gray(`    - ${idx.collectionGroup} [${(idx.fields || []).map(f => `${f.fieldPath} ${f.order || f.arrayConfig}`).join(', ')}]`));
        }
      }
      if (localOnly.length === 0 && liveOnly.length === 0) {
        // Indexes arrays match but fieldOverrides or other top-level keys differ
        const localKeys = Object.keys(localIndexes || {});
        const liveKeys = Object.keys(liveIndexes || {});
        const allKeys = _.union(localKeys, liveKeys);
        for (const key of allKeys) {
          if (!_.isEqual(localIndexes?.[key], liveIndexes?.[key])) {
            console.log(chalk.yellow(`  Difference in "${key}":`));
            console.log(chalk.gray(`    Local: ${JSON.stringify(localIndexes?.[key])}`));
            console.log(chalk.gray(`    Live:  ${JSON.stringify(liveIndexes?.[key])}`));
          }
        }
      }
    }

    // The read-only comparison above already printed what is out of sync. Under
    // --offline the only remedy (fix() → `firebase deploy`) is off the table, so
    // the verdict downgrades to a non-blocking warning: the runner reports the
    // drift in the summary and never reaches the mutating fix (#284).
    if (!equal && localIndexes_exists && this.isOffline) {
      return 'warn';
    }

    return !localIndexes_exists || equal;
  }

  async fix() {
    const self = this.self;
    const filePath = `${self.firebaseProjectPath}/firestore.indexes.json`;

    if (this.isDemoProject) {
      return; // run() never fails demo projects; never touch the live API here
    }

    // Belt for a direct caller: run() already downgrades drift to a warning
    // under --offline, so the runner can never land here. Nothing below may
    // spawn — the deploy at the end rewrites the live project's indexes.
    if (this.isOffline) {
      console.log(chalk.yellow(`  ⚠ Skipping the live index sync (--offline) — indexes are out of sync and were NOT deployed`));
      return;
    }

    // Fetch live indexes
    const IndexesCommand = require('../indexes');
    const indexesCmd = new IndexesCommand(self);
    const tempPath = '_firestore.indexes.json';
    const liveIndexes = await indexesCmd.get(tempPath, false);
    jetpack.remove(`${self.firebaseProjectPath}/${tempPath}`);

    // Read local indexes
    let localIndexes = { indexes: [], fieldOverrides: [] };
    if (jetpack.exists(filePath)) {
      localIndexes = JSON.parse(jetpack.read(filePath));
    }

    // Merge: start with local, add any live indexes that don't already exist locally
    const merged = [...(localIndexes.indexes || [])];
    const liveList = (liveIndexes?.indexes || []);

    for (const liveIdx of liveList) {
      const alreadyExists = merged.some(localIdx => this._normalizedMatch(localIdx, liveIdx));

      if (!alreadyExists) {
        merged.push(this._stripImplicitFields(liveIdx));
      }
    }

    // Merge fieldOverrides the same way
    const mergedOverrides = [...(localIndexes.fieldOverrides || [])];
    for (const liveOverride of (liveIndexes?.fieldOverrides || [])) {
      const alreadyExists = mergedOverrides.some(lo => _.isEqual(lo, liveOverride));

      if (!alreadyExists) {
        mergedOverrides.push(liveOverride);
      }
    }

    // Write merged result locally
    const result = { indexes: merged, fieldOverrides: mergedOverrides };
    jetpack.write(filePath, JSON.stringify(result, null, 2));

    const addedCount = merged.length - (localIndexes.indexes || []).length;
    console.log(chalk.green(`  ✓ Merged indexes (${merged.length} total, ${addedCount} added from live)`));

    // Deploy merged indexes to live
    console.log(chalk.yellow(`  Deploying merged indexes to live...`));
    await powertools.execute('firebase deploy --only firestore:indexes', {
      log: true,
      cwd: self.firebaseProjectPath,
    });

    console.log(chalk.green(`  ✓ Live indexes synced`));
  }

  /**
   * Check if two indexes match (ignoring implicit __name__ fields and density)
   */
  _normalizedMatch(a, b) {
    if (!a || !b) {
      return false;
    }

    if (a.collectionGroup !== b.collectionGroup) {
      return false;
    }

    if ((a.queryScope || 'COLLECTION') !== (b.queryScope || 'COLLECTION')) {
      return false;
    }

    const aFields = (a.fields || []).filter(f => f.fieldPath !== '__name__');
    const bFields = (b.fields || []).filter(f => f.fieldPath !== '__name__');

    if (aFields.length !== bFields.length) {
      return false;
    }

    return aFields.every((af, i) => {
      const bf = bFields[i];
      return af.fieldPath === bf.fieldPath
        && (af.order || null) === (bf.order || null)
        && (af.arrayConfig || null) === (bf.arrayConfig || null);
    });
  }

  /**
   * Strip implicit fields Firebase adds to live indexes (density, __name__)
   */
  _stripImplicitFields(idx) {
    const { density, ...rest } = idx;
    return {
      ...rest,
      fields: (rest.fields || []).filter(f => f.fieldPath !== '__name__'),
    };
  }
}

module.exports = FirestoreIndexesSyncedTest;
