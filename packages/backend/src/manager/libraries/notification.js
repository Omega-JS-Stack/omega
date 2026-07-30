/**
 * Push notification library — send FCM notifications to subscribers
 *
 * Usage:
 *   const notification = require('./libraries/notification.js');
 *   await notification.send(ctx, { title, body, icon, clickAction, filters });
 *
 * Used by:
 * - POST /admin/notification route
 * - marketing-campaigns cron job (type: 'push')
 */
const PATH_NOTIFICATIONS = 'notifications';
const BAD_TOKEN_REASONS = [
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
];
const BATCH_SIZE = 500;

/**
 * Send push notification to FCM subscribers.
 *
 * @param {object} ctx - @omega.js/backend ctx instance
 * @param {object} options
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {string} [options.icon] - Notification icon URL (defaults to brand.images.brandmark)
 * @param {string} [options.clickAction] - URL to open on click (defaults to brand.url)
 * @param {object} [options.filters] - Targeting filters
 * @param {Array<string>} [options.filters.tags] - Filter by tags
 * @param {string} [options.filters.owner] - Filter by owner UID
 * @param {string} [options.filters.token] - Send to specific token
 * @param {number} [options.filters.limit] - Max tokens to send to
 * @returns {{ subscribers: number, batches: number, sent: number, deleted: number }}
 */
async function send(ctx, options) {
  const { title, body, icon, clickAction, filters } = options;

  if (!title || !body) {
    throw new Error('Notification title and body are required');
  }

  const notification = buildPayload(ctx.Manager.config?.brand, { title, body, icon, clickAction });

  ctx.log('notification.send():', notification);

  const response = { subscribers: 0, batches: 0, sent: 0, deleted: 0 };
  const filterOptions = {
    tags: filters?.tags || false,
    owner: filters?.owner || null,
    token: filters?.token || null,
    limit: filters?.limit || null,
  };

  await processTokens(ctx, notification, filterOptions, response);

  return response;
}

/**
 * Build the FCM payload from the caller's options and the brand's OWN config.
 *
 * A push notification lands on a user's lock screen wearing whoever's icon and
 * link it carries, so there is no framework fallback for either. The icon comes
 * from `brand.images.brandmark` and is OMITTED when unconfigured (a text-only
 * notification, never another company's mark); the click target comes from
 * `brand.url` and fails LOUDLY when unconfigured, because a push with nowhere
 * to go is not worth sending anywhere else.
 *
 * @param {object} brand - Resolved brand config object
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} [options.icon] - Explicit icon URL (wins over config)
 * @param {string} [options.clickAction] - Explicit click target (wins over config)
 * @returns {{ title: string, body: string, imageUrl?: string, click_action: string }}
 * @throws {Error} When no click target is configured, or it is not a valid URL
 */
function buildPayload(brand, { title, body, icon, clickAction }) {
  const imageUrl = icon || brand?.images?.brandmark;
  const clickTarget = clickAction || brand?.url;

  if (!clickTarget) {
    // Coded 400 like the email library's config-hole throws — a code-less Error
    // would respond as a 500 and capture to Sentry for what is a brand-config fault.
    const err = new Error('Missing brand.url in config/omega.json5 — required to send a push notification (or pass clickAction)');
    err.code = 400;
    throw err;
  }

  const notification = { title, body, click_action: clickTarget };

  if (imageUrl) {
    notification.imageUrl = imageUrl;
  }

  // Add cache buster to click_action URL
  try {
    const url = new URL(notification.click_action);
    url.searchParams.set('cb', new Date().getTime());
    notification.click_action = url.toString();
  } catch (e) {
    throw new Error(`Invalid click_action URL: ${e.message}`);
  }

  return notification;
}

async function processTokens(ctx, notification, options, response) {
  const Manager = ctx.Manager;

  // Specific token — send directly
  if (options.token) {
    ctx.log(`Sending to specific token: ${options.token}`);

    try {
      await sendBatch(ctx, [options.token], 0, notification, response);
    } catch (e) {
      ctx.error('Error sending to specific token', e);
    }

    return;
  }

  // Build query conditions
  const queryConditions = [];

  if (options.tags) {
    queryConditions.push({ field: 'tags', operator: 'array-contains-any', value: options.tags });
  }
  if (options.owner) {
    queryConditions.push({ field: 'owner', operator: '==', value: options.owner });
  }

  const maxBatches = options.limit
    ? Math.ceil(options.limit / BATCH_SIZE)
    : Infinity;

  ctx.log('Processing tokens with filters:', {
    tags: options.tags,
    owner: options.owner,
    limit: options.limit,
    maxBatches,
  });

  let tokensProcessed = 0;

  await Manager.Utilities().iterateCollection(
    async (batch, index) => {
      const batchTokens = [];

      for (const doc of batch.docs) {
        if (options.limit && tokensProcessed >= options.limit) {
          break;
        }

        const data = doc.data();
        batchTokens.push(data.token);
        tokensProcessed++;
      }

      if (batchTokens.length === 0) {
        return;
      }

      try {
        ctx.log(`Sending batch ${index} with ${batchTokens.length} tokens.`);
        await sendBatch(ctx, batchTokens, index, notification, response);
      } catch (e) {
        ctx.error(`Error sending batch ${index}`, e);
      }
    },
    {
      collection: PATH_NOTIFICATIONS,
      where: queryConditions,
      batchSize: BATCH_SIZE,
      maxBatches,
      log: true,
    }
  ).catch(e => {
    ctx.error(`Error during token processing: ${e}`);
  });
}

async function sendBatch(ctx, batch, id, notification, response) {
  const { admin } = ctx.Manager.libraries;

  ctx.log(`Sending batch #${id}: tokens=${batch.length}...`);

  const messages = batch.map(token => ({
    token,
    notification: {
      title: notification.title,
      body: notification.body,
      ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
    },
    webpush: {
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.imageUrl ? { icon: notification.imageUrl } : {}),
        click_action: notification.click_action,
      },
      data: {
        click_action: notification.click_action,
      },
      fcm_options: {
        link: notification.click_action,
      },
    },
    data: {
      click_action: notification.click_action,
    },
  }));

  const result = await admin.messaging().sendEach(messages);

  ctx.log(`Sent batch #${id}: success=${result.successCount}, failures=${result.failureCount}`);

  result.responses = result.responses.map((item, index) => {
    item.token = batch[index];
    return item;
  });

  // Clean bad tokens
  if (result.failureCount > 0) {
    await cleanTokens(ctx, batch, result.responses, id, response);
  }

  response.sent += (batch.length - result.failureCount);
  response.batches++;
}

async function cleanTokens(ctx, batch, results, id, response) {
  const { admin } = ctx.Manager.libraries;

  const cleanPromises = results
    .map((item) => {
      if (!item.error || !BAD_TOKEN_REASONS.includes(item?.error?.code)) {
        return null;
      }

      return admin.firestore().doc(`${PATH_NOTIFICATIONS}/${item.token}`).delete()
        .then(() => {
          ctx.log(`Deleted bad token: ${item.token} (${item.error.code})`);
          response.deleted++;
        })
        .catch((e) => {
          ctx.error(`Failed to delete bad token: ${item.token}`, e);
        });
    })
    .filter(Boolean);

  await Promise.all(cleanPromises);
}

module.exports = { send, buildPayload };
