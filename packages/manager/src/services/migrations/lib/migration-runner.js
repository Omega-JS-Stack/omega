/**
 * Migration Runner — ported from omega-manager's migration-runner with the
 * firebase-admin Firestore replaced by the shared FirestoreREST client.
 *
 * Abstracts the common pattern of iterating a collection, fixing docs, and
 * validating. Handles stats tracking, logging, before/after snapshots
 * (.omega/migrations/{collection}/{timestamp}/), and the summary.
 *
 * A run is an AUDIT by default (Ian 2026-08-20): every fix is computed,
 * counted, logged and snapshotted, and Firestore is never touched. `--execute`
 * is the only path that writes — nobody mutates a brand's collections by
 * forgetting a flag.
 *
 * Fix functions receive (data, doc, db):
 *   - data: the plain document object (mutated in place as fixes apply)
 *   - doc: { id, createTime, updateTime } — server metadata (ISO strings,
 *     the REST stand-in for the admin SDK's DocumentSnapshot)
 *   - db: the FirestoreREST client (getDoc/patchDoc/deleteDoc/...)
 * and return a dot-notation update map, null for no-op,
 * { __delete__: true, reason } to delete the document, or updates carrying
 * a `__logs__` array of per-field log lines.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

// Field-deletion sentinel — replaces firebase-admin's FieldValue.delete().
// In a REST patch, a path in the updateMask with no value in the body IS the
// delete, so the sentinel only has to be identity-comparable.
const DELETE = Symbol('FieldValue.delete');
const FieldValue = { delete: () => DELETE };

/**
 * Iterate a collection in pages via the REST client.
 *
 * @param {Object} firestore - FirestoreREST client
 * @param {string} collectionPath - Collection to iterate
 * @param {Function} callback - Async (docs, batch, total) per page
 * @param {Object} options - { batchSize, maxBatches }
 */
async function iterateCollection(firestore, collectionPath, callback, options = {}) {
  const batchSize = options.batchSize || 500;
  const maxBatches = options.maxBatches || Infinity;

  const totalCount = await firestore.countDocs(collectionPath);
  console.log(`      ${chalk.dim('→')} ${chalk.cyan(totalCount)} documents in ${chalk.cyan(collectionPath)}`);

  let batch = 0;
  let pageToken = null;

  while (true) {
    const page = await firestore.listDocs(collectionPath, { pageSize: batchSize, pageToken });
    console.log(chalk.dim(`      Batch ${chalk.cyan(batch + 1)}: ${chalk.cyan(page.docs.length)} documents`));

    if (page.docs.length === 0) {
      break;
    }

    await callback(page.docs, batch, totalCount);

    batch++;
    pageToken = page.nextPageToken;

    if (!pageToken || batch >= maxBatches) {
      break;
    }
  }
}

/**
 * Split a merged dot-notation update map into the REST patch pieces: the
 * updateMask field paths (sets AND deletes) and the nested body object
 * (sets only — a masked path absent from the body is a delete).
 */
function buildPatch(mergedUpdates) {
  const fieldPaths = Object.keys(mergedUpdates);
  const sets = {};

  for (const [path, value] of Object.entries(mergedUpdates)) {
    if (value === DELETE) {
      continue;
    }
    const parts = path.split('.');
    let target = sets;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) {
        target[parts[i]] = {};
      }
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  return { fieldPaths, sets };
}

/**
 * Run a migration over a collection.
 *
 * @param {Object} context - Handler context (brandId, brandRoot, firestore, options)
 * @param {Object} options - Migration options
 * @param {string} options.collection - Collection path to iterate
 * @param {Array<Function>} options.fixes - Fix functions: (data, doc, db) => updates object or null
 * @param {Function} options.validate - Validate function: (data, docId) => { valid, errors }
 * @param {number} options.batchSize - Batch size (default: 500)
 * @returns {Object} { output: { [collection]: stats }, status?, error? }
 */
async function runMigration(context, options) {
  const { brandRoot, firestore } = context;
  const { collection, fixes = [], validate } = options;
  // The manage-wide --dry-run vetoes --execute: passing both means "don't write"
  const execute = (context.options?.execute && !context.options?.dryRun) || false;
  const verbose = context.options?.verbose || false;
  const limit = context.options?.limit || 0;
  const ids = context.options?.ids ? String(context.options.ids).split(',').map((id) => id.trim()) : null;
  const batchSize = limit ? Math.min(options.batchSize || 500, limit) : (options.batchSize || 500);

  const vetoed = context.options?.execute && context.options?.dryRun;
  const modeLabel = execute
    ? chalk.red(' [EXECUTE]')
    : chalk.yellow(vetoed ? ' [AUDIT — --dry-run vetoes --execute]' : ' [AUDIT — pass --execute to write]');
  const limitLabel = limit ? chalk.dim(` (limit: ${chalk.cyan(limit)})`) : '';
  const idsLabel = ids ? chalk.dim(` (${chalk.cyan(ids.length)} specific IDs)`) : '';
  console.log(`    ${chalk.dim('→')} Processing ${chalk.cyan(collection)} for ${chalk.cyan(firestore.projectId)}...${modeLabel}${limitLabel}${idsLabel}`);

  // Track stats
  const stats = {
    totalDocs: 0,
    validDocs: 0,
    invalidDocs: 0,
    docsFixed: 0,
    docsDeleted: 0,
    errors: 0,
    invalidDocIds: [],
    errorDocIds: [],
  };

  // Snapshot directory for before/after records
  const snapshotDir = join(brandRoot, '.omega', 'migrations', collection,
    new Date().toISOString().replace(/:/g, '-').replace(/\..+/, ''));

  try {
    // If specific IDs provided, fetch just those docs instead of iterating the whole collection
    const iterateFn = ids
      ? async (callback) => {
        const docs = [];
        for (const id of ids) {
          const doc = await firestore.getDocWithMeta(`${collection}/${id}`);
          if (doc) {
            docs.push(doc);
          } else {
            console.log(`    ${chalk.yellow('⚠')} ${chalk.yellow(`Document not found: ${id}`)}`);
          }
        }
        if (docs.length > 0) {
          await callback(docs, 1, docs.length);
        }
      }
      : (callback) => iterateCollection(firestore, collection, callback, { batchSize, maxBatches: limit ? 1 : Infinity });

    await iterateFn(async (docs, batch, total) => {
      // Apply limit within the batch
      const docsToProcess = limit ? docs.slice(0, limit - stats.totalDocs) : docs;

      // Process all docs in the batch concurrently
      const results = await Promise.all(docsToProcess.map(async (doc) => {
        const data = doc.data;
        const before = JSON.parse(JSON.stringify(data));
        const logs = [];
        const errorMessages = [];
        let docWasFixed = false;
        let docErrors = 0;

        // Collect all updates from fixes into a single merged object
        const mergedUpdates = {};
        let docDeleted = false;

        // Run fix functions sequentially (fixes depend on each other)
        for (const fix of fixes) {
          try {
            const updates = await fix(data, doc, firestore);
            if (!updates) {
              continue;
            }

            // Handle document deletion
            if (updates.__delete__) {
              docDeleted = true;
              const reason = updates.reason || 'unknown';

              if (execute) {
                await firestore.deleteDoc(`${collection}/${doc.id}`);
                logs.push(`        ${chalk.red('🗑')} ${chalk.red(`Deleted document (${chalk.cyan(reason)})`)}`);
              } else {
                logs.push(`        ${chalk.yellow('~')} ${chalk.yellow(`Would delete document (${chalk.cyan(reason)})`)}`);
              }
              break;
            }

            // Extract sentinel: per-field log lines to render under this doc's header
            const extraLogs = Array.isArray(updates.__logs__) ? updates.__logs__ : null;
            if (extraLogs) {
              delete updates.__logs__;
              logs.push(...extraLogs);
            }

            if (Object.keys(updates).length === 0) {
              continue;
            }

            docWasFixed = true;
            Object.assign(mergedUpdates, updates);

            // Log what's being fixed
            const fixedFields = Object.keys(updates).filter((k) => updates[k] !== DELETE);
            const deletedFields = Object.keys(updates).filter((k) => updates[k] === DELETE);
            const desc = [...fixedFields.map((f) => `+${f}`), ...deletedFields.map((f) => `-${f}`)].join(', ');

            if (execute) {
              logs.push(`        ${chalk.green('✓')} ${chalk.green(`Fixed (${chalk.cyan(desc)})`)}`);
            } else {
              logs.push(`        ${chalk.yellow('~')} ${chalk.yellow(`Would fix (${chalk.cyan(desc)})`)}`);
            }

            // Apply updates to local data for subsequent fixes and validation
            for (const [key, value] of Object.entries(updates)) {
              const parts = key.split('.');
              if (parts.length === 1) {
                if (value === DELETE) {
                  delete data[key];
                } else {
                  data[key] = value;
                }
              } else {
                const last = parts.pop();
                let target = data;
                for (const part of parts) {
                  if (target[part] === undefined) {
                    target[part] = {};
                  }
                  target = target[part];
                }
                if (value === DELETE) {
                  delete target[last];
                } else {
                  target[last] = value;
                }
              }
            }
          } catch (error) {
            docErrors++;
            errorMessages.push(`Fix failed: ${error.message}`);
            logs.push(`        ${chalk.red('❌')} ${chalk.red('Fix failed')}${chalk.dim(`: ${error.message}`)}`);
          }
        }

        // Resolve conflicts: if an ancestor path and a descendant path both exist
        // in the same update (e.g. `metadata.created` + `metadata.created.timestamp`,
        // or `activity` + `activity.foo.bar`), merge the descendants into the
        // ancestor's object value. Firestore rejects updates that specify the same
        // field via overlapping paths.
        //
        // Process ancestors from shortest to longest so that longer ancestors absorb
        // their descendants before being absorbed themselves.
        if (docWasFixed) {
          const ancestorKeys = Object.keys(mergedUpdates)
            .filter((k) => {
              const value = mergedUpdates[k];
              return value !== DELETE
                && value !== null
                && typeof value === 'object'
                && !Array.isArray(value);
            })
            .sort((a, b) => a.split('.').length - b.split('.').length);

          for (const ancestorKey of ancestorKeys) {
            if (!(ancestorKey in mergedUpdates)) {
              continue;
            }

            const descendantKeys = Object.keys(mergedUpdates).filter((k) => k.startsWith(`${ancestorKey}.`));
            for (const descKey of descendantKeys) {
              const subParts = descKey.substring(ancestorKey.length + 1).split('.');
              let target = mergedUpdates[ancestorKey];
              for (let i = 0; i < subParts.length - 1; i++) {
                if (target[subParts[i]] === undefined) {
                  target[subParts[i]] = {};
                }
                target = target[subParts[i]];
              }

              // A delete can't be nested inside a set object — just drop the key
              if (mergedUpdates[descKey] === DELETE) {
                delete target[subParts[subParts.length - 1]];
              } else {
                target[subParts[subParts.length - 1]] = mergedUpdates[descKey];
              }
              delete mergedUpdates[descKey];
            }
          }
        }

        // If doc was deleted, skip write/validate
        if (docDeleted) {
          jetpack.write(join(snapshotDir, `${doc.id}.json`), {
            before,
            after: null,
            deleted: true,
          });

          return { doc, before, logs, errorMessages, docWasFixed: false, docDeleted, isValid: null, docErrors };
        }

        // Write all fixes in a single Firestore call
        if (docWasFixed && execute && Object.keys(mergedUpdates).length > 0) {
          try {
            const { fieldPaths, sets } = buildPatch(mergedUpdates);
            await firestore.patchDoc(`${collection}/${doc.id}`, sets, fieldPaths);
          } catch (error) {
            docErrors++;
            errorMessages.push(`Write failed: ${error.message}`);
            logs.push(`        ${chalk.red('❌')} ${chalk.red('Write failed')}${chalk.dim(`: ${error.message}`)}`);
          }
        }

        // Run validate function if provided
        let isValid = null;
        if (validate) {
          const result = await validate(data, doc.id);
          isValid = result.valid;

          if (result.valid) {
            logs.push(`        ${chalk.green('✓')} ${chalk.green('Valid')}`);
          } else {
            for (const error of result.errors) {
              logs.push(`        ${chalk.red('❌')} ${chalk.red(error.field)}${chalk.dim(`: ${error.message}`)}`);
            }
          }
        }

        // Save before/after snapshot
        jetpack.write(join(snapshotDir, `${doc.id}.json`), {
          before,
          after: data,
          fixed: docWasFixed,
          valid: isValid,
        });

        return { doc, before, logs, errorMessages, docWasFixed, docDeleted, isValid, docErrors };
      }));

      // Flush logs and update stats
      for (const { doc, before, logs, errorMessages, docWasFixed, docDeleted, isValid, docErrors } of results) {
        stats.totalDocs++;

        // Only log docs with fixes, errors, deletions, or invalid — skip "Valid" only docs unless verbose
        const hasActivity = docWasFixed || docDeleted || docErrors > 0 || isValid === false;
        if (hasActivity || verbose) {
          console.log(chalk.cyan(`      [${stats.totalDocs}/${total}] ${doc.id}`));
          if (verbose) {
            console.log(chalk.dim(JSON.stringify(before, null, 2).split('\n').map((l) => `        ${l}`).join('\n')));
          }
          for (const log of logs) {
            console.log(log);
          }
        }

        stats.errors += docErrors;
        if (docErrors > 0) {
          stats.errorDocIds.push({ id: doc.id, errors: errorMessages });
        }
        if (docDeleted) {
          stats.docsDeleted++;
        } else if (docWasFixed) {
          stats.docsFixed++;
        }
        if (isValid === true) {
          stats.validDocs++;
        } else if (isValid === false) {
          stats.invalidDocs++;
          stats.invalidDocIds.push(doc.id);
        }
      }

      // Progress log every batch
      console.log(chalk.dim(`      Processed ${chalk.cyan(`${stats.totalDocs}/${total}`)} documents...`));
    });

    // Save summary.json
    const summaryPath = join(snapshotDir, '_summary.json');
    const summary = {
      collection,
      brandId: context.brandId,
      projectId: firestore.projectId,
      execute,
      timestamp: new Date().toISOString(),
      stats: {
        totalDocs: stats.totalDocs,
        validDocs: validate ? stats.validDocs : undefined,
        invalidDocs: validate ? stats.invalidDocs : undefined,
        docsFixed: fixes.length > 0 ? stats.docsFixed : undefined,
        docsDeleted: stats.docsDeleted > 0 ? stats.docsDeleted : undefined,
        errors: stats.errors > 0 ? stats.errors : undefined,
      },
      errorDocIds: stats.errorDocIds.length > 0 ? stats.errorDocIds : undefined,
      invalidDocIds: stats.invalidDocIds.length > 0 ? stats.invalidDocIds : undefined,
    };
    jetpack.write(summaryPath, summary);

    // Console summary
    const parts = [`${chalk.bold(stats.totalDocs)} total`];
    if (stats.docsFixed > 0) {
      parts.push(`${chalk.green(chalk.bold(stats.docsFixed))} fixed`);
    }
    if (stats.docsDeleted > 0) {
      parts.push(`${chalk.red(chalk.bold(stats.docsDeleted))} deleted`);
    }
    if (validate) {
      parts.push(`${chalk.green(chalk.bold(stats.validDocs))} valid`);
    }
    if (stats.invalidDocs > 0) {
      parts.push(`${chalk.red(chalk.bold(stats.invalidDocs))} invalid`);
    }
    if (stats.errors > 0) {
      parts.push(`${chalk.red(chalk.bold(stats.errors))} errors`);
    }

    const hasIssues = stats.errors > 0 || stats.invalidDocs > 0;
    const icon = hasIssues ? chalk.yellow('⚠') : chalk.green('✓');
    console.log(`    ${icon} ${parts.join(', ')}`);
    console.log(`    ${chalk.dim(`Log: ${summaryPath}`)}`);

    // Show retry hint if there are errors
    if (stats.errorDocIds.length > 0) {
      const errorIds = stats.errorDocIds.map((e) => e.id).join(',');
      console.log(`    ${chalk.yellow('Retry failed:')} --ids=${errorIds}`);
    }
    if (stats.invalidDocIds.length > 0) {
      const invalidIds = stats.invalidDocIds.join(',');
      console.log(`    ${chalk.yellow('Review invalid:')} --ids=${invalidIds}`);
    }
    console.log('');
  } catch (error) {
    console.log(`    ${chalk.red('❌')} ${chalk.red('Error during migration')}${chalk.dim(`: ${error.message}`)}`);
    return { status: 'error', error: error.message };
  }

  // Data issues (fix/write failures, schema-invalid docs) surface as warned —
  // omega-manager printed the ⚠ but swallowed it into a success status
  const result = {
    output: {
      [collection]: {
        totalDocs: stats.totalDocs,
        validDocs: validate ? stats.validDocs : undefined,
        invalidDocs: validate ? stats.invalidDocs : undefined,
        docsFixed: fixes.length > 0 ? stats.docsFixed : undefined,
        docsDeleted: stats.docsDeleted > 0 ? stats.docsDeleted : undefined,
        errors: stats.errors > 0 ? stats.errors : undefined,
        errorDocIds: stats.errorDocIds.length > 0 ? stats.errorDocIds : undefined,
        invalidDocIds: stats.invalidDocs > 0 ? stats.invalidDocIds : undefined,
      },
    },
  };

  if (stats.errors > 0 || stats.invalidDocs > 0) {
    result.status = 'warned';
  }

  return result;
}

module.exports = { runMigration, FieldValue };
