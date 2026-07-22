/**
 * Reset usage cron job
 *
 * Runs daily at midnight UTC and handles different reset schedules:
 * - Local storage: cleared every day
 * - Unauthenticated usage collection: deleted every day
 * - Authenticated user daily counters: reset every day
 * - Authenticated user monthly counters: reset on the 1st of each month
 */
module.exports = async ({ Manager, ctx, context, libraries }) => {
  const storage = Manager.storage({ name: 'usage', temporary: true, clear: false, log: false });

  ctx.log('Starting...');

  // Clear local storage (daily)
  clearLocal(ctx, storage);

  // Clear unauthenticated usage collection (daily)
  await clearUnauthenticatedUsage(ctx, libraries);

  // Reset authenticated user counters (daily + monthly on 1st)
  await resetAuthenticated(Manager, ctx);
};

function clearLocal(ctx, storage) {
  ctx.log('[local]: Clearing...');
  storage.setState({}).write();
  ctx.log('[local]: Completed!');
}

async function clearUnauthenticatedUsage(ctx, libraries) {
  const { admin } = libraries;

  ctx.log('[unauthenticated]: Deleting usage collection...');

  await admin.firestore().recursiveDelete(admin.firestore().collection('usage'))
  .then(() => {
    ctx.log('[unauthenticated]: Completed!');
  })
  .catch((e) => {
    ctx.report(`Error deleting usage collection: ${e}`, { code: 500 });
  });
}

async function resetAuthenticated(Manager, ctx) {
  const isFirstOfMonth = new Date().getDate() === 1;
  const products = Manager.config.payment?.products || [];

  // Gather all metric names from all products
  const metricSet = { requests: true };
  for (const product of products) {
    for (const key of Object.keys(product.limits || {})) {
      metricSet[key] = true;
    }
  }
  const metricNames = Object.keys(metricSet);

  ctx.log(`[authenticated]: Resetting ${isFirstOfMonth ? 'daily + monthly' : 'daily'} for metrics`, metricNames);

  // Collect all user IDs that need resetting (deduplicated across metrics)
  // Each entry maps uid -> { ref, usage } so we only write once per user
  const usersToReset = {};

  for (const metric of metricNames) {
    // Query users with daily > 0 for this metric
    await Manager.Utilities().iterateCollection((batch) => {
      return new Promise(async (resolve) => {
        for (const doc of batch.docs) {
          if (!usersToReset[doc.id]) {
            usersToReset[doc.id] = { ref: doc.ref, usage: doc.data().usage || {} };
          }
        }
        return resolve();
      });
    }, {
      collection: 'users',
      where: [
        { field: `usage.${metric}.daily`, operator: '>', value: 0 },
      ],
      batchSize: 5000,
      log: false,
    })
    .catch(e => {
      ctx.report(`Error querying ${metric}.daily: ${e}`, { code: 500 });
    });

    // On the 1st, also query users with monthly > 0
    if (isFirstOfMonth) {
      await Manager.Utilities().iterateCollection((batch) => {
        return new Promise(async (resolve) => {
          for (const doc of batch.docs) {
            if (!usersToReset[doc.id]) {
              usersToReset[doc.id] = { ref: doc.ref, usage: doc.data().usage || {} };
            }
          }
          return resolve();
        });
      }, {
        collection: 'users',
        where: [
          { field: `usage.${metric}.monthly`, operator: '>', value: 0 },
        ],
        batchSize: 5000,
        log: false,
      })
      .catch(e => {
        ctx.report(`Error querying ${metric}.monthly: ${e}`, { code: 500 });
      });
    }
  }

  const userIds = Object.keys(usersToReset);
  ctx.log(`[authenticated]: Found ${userIds.length} users to reset`);

  // Single write per user: reset daily (always) + monthly (on 1st) for all metrics
  for (const uid of userIds) {
    const { ref, usage } = usersToReset[uid];

    for (const metric of metricNames) {
      if (!usage[metric]) {
        continue;
      }

      usage[metric].daily = 0;

      if (isFirstOfMonth) {
        usage[metric].monthly = 0;
      }
    }

    await ref.update({ usage })
    .then(() => {
      ctx.log(`[authenticated]: Reset ${uid}`);
    })
    .catch(e => {
      ctx.report(`Error resetting ${uid}: ${e}`, { code: 500 });
    });
  }

  ctx.log(`[authenticated]: Completed!`);
}
