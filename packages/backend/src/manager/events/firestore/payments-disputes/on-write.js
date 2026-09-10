const path = require('path');
const loadProvider = require('../../../libraries/load-provider.js');
const powertools = require('node-powertools');
const { escapeHtml, safeUrl } = require('../../../libraries/email/constants.js');

/**
 * Firestore trigger: payments-disputes/{alertId} onWrite
 *
 * Processes pending dispute alerts:
 * 1. Loads the provider module for the alert's payment provider
 * 2. Searches for the matching charge via provider.searchAndMatch()
 * 3. Issues refund + cancels subscription via provider.processDispute()
 * 4. Sends email alert to brand contact
 * 5. Updates dispute document with results
 */
module.exports = async ({ ctx, change, context }) => {
  const Manager = ctx.Manager;
  const admin = Manager.libraries.admin;

  const dataAfter = change.after.data();

  // Short-circuit: deleted doc or non-pending status
  if (!dataAfter || dataAfter.status !== 'pending') {
    return;
  }

  const alertId = context.params.alertId;
  const disputeRef = admin.firestore().doc(`payments-disputes/${alertId}`);

  // Set status to processing
  await disputeRef.set({ status: 'processing' }, { merge: true });

  try {
    const alert = dataAfter.alert;
    const provider = alert.provider || 'stripe';

    ctx.log(`Processing dispute ${alertId}: provider=${provider}, amount=${alert.amount}, card=****${alert.card.last4}, date=${alert.transactionDate}, chargeId=${alert.chargeId || 'none'}, paymentIntentId=${alert.paymentIntentId || 'none'}`);

    // Load the provider module
    let providerModule;
    try {
      providerModule = loadProvider(path.join(__dirname, 'providers'), provider);
    } catch (e) {
      throw new Error(`Unsupported dispute provider: ${provider}`);
    }

    // Search for the matching charge
    const match = await providerModule.searchAndMatch(alert, ctx);

    // Build timestamps
    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    if (!match) {
      // No matching charge found
      await disputeRef.set({
        status: 'no-match',
        match: null,
        actions: {
          refund: 'skipped',
          cancel: 'skipped',
          email: 'pending',
        },
        metadata: {
          completed: {
            timestamp: now,
            timestampUNIX: nowUNIX,
          },
        },
      }, { merge: true });

      ctx.log(`Dispute ${alertId}: no matching charge found`);

      // Still send email to alert brand about unmatched dispute. No testing-mode
      // gate — the mailer's own seam captures a testing send instead of delivering
      // it ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
      const emailStatus = await sendDisputeEmail({ alert, match: null, result: null, alertId, ctx });
      await disputeRef.set({ actions: { email: emailStatus } }, { merge: true });

      return;
    }

    // Process refund and cancel
    const result = await providerModule.processDispute(match, alert, ctx);

    // Update dispute document with results
    await disputeRef.set({
      status: 'resolved',
      match: {
        invoiceId: match.invoiceId || null,
        subscriptionId: match.subscriptionId || null,
        customerId: match.customerId,
        uid: match.uid || null,
        email: match.email || null,
        chargeId: match.chargeId,
        refundId: result.refundId || null,
        amountRefunded: result.amountRefunded || null,
        currency: result.currency || null,
      },
      actions: {
        refund: result.refundStatus,
        cancel: result.cancelStatus,
        email: 'pending',
      },
      errors: result.errors,
      metadata: {
        completed: {
          timestamp: now,
          timestampUNIX: nowUNIX,
        },
      },
    }, { merge: true });

    // Send email alert — awaited, because the dispute doc records its outcome. No
    // testing-mode gate — the mailer's own seam captures a testing send instead of
    // delivering it ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
    const emailStatus = await sendDisputeEmail({ alert, match, result, alertId, ctx });
    await disputeRef.set({ actions: { email: emailStatus } }, { merge: true });

    ctx.log(`Dispute ${alertId} resolved: refund=${result.refundStatus}, cancel=${result.cancelStatus}`);
  } catch (e) {
    ctx.error(`Dispute ${alertId} failed: ${e.message}`, e);

    await disputeRef.set({
      status: 'failed',
      error: e.message || String(e),
    }, { merge: true });
  }
};

/**
 * Send dispute alert email to brand contact
 *
 * Returns the outcome the dispute doc records — the caller must never claim a send
 * that did not happen, so this resolves rather than throws.
 *
 * @param {object} options
 * @param {object} options.alert - Normalized alert data
 * @param {object|null} options.match - Match details (null if no match)
 * @param {object} [options.result] - Processing result (refund/cancel statuses)
 * @param {string} options.alertId - Dispute alert ID
 * @param {object} options.ctx - Assistant instance
 * @returns {Promise<'success'|'failed'|'skipped'>}
 */
function sendDisputeEmail({ alert, match, result, alertId, ctx }) {
  const Manager = ctx.Manager;
  const email = Manager.Email(ctx);
  const brandEmail = Manager.config.brand?.contact?.email;

  if (!brandEmail) {
    ctx.error(`sendDisputeEmail(): No brand.contact.email configured, skipping`);
    return Promise.resolve('skipped');
  }

  const matched = match ? 'Matched' : 'Unmatched';
  const subject = `Dispute Alert: ${matched} — $${alert.amount} on ****${alert.card.last4} [${alertId}]`;

  // The alert body is hand-built markup (trustedContent below), so every value that
  // came off the dispute webhook or the provider match gets escaped on the way in.
  const messageLines = [];

  // Status banner
  if (match && result) {
    const hasErrors = result.errors?.length > 0;
    const banner = hasErrors ? 'Partially processed (see errors below)' : 'Automatically processed';
    messageLines.push(`<strong>${banner}</strong>`);
  } else {
    messageLines.push('<strong>Could not be matched to a charge — manual review required.</strong>');
  }

  messageLines.push('');

  // Alert details
  messageLines.push('<strong>Alert Details:</strong>');
  messageLines.push('<ul>');
  messageLines.push(`<li><strong>Alert ID:</strong> ${escapeHtml(alertId)}</li>`);
  messageLines.push(`<li><strong>Type:</strong> ${escapeHtml(alert.alertType || 'N/A')}</li>`);
  messageLines.push(`<li><strong>Card:</strong> ****${escapeHtml(alert.card.last4)} (${escapeHtml(alert.card.brand || 'unknown')})</li>`);
  messageLines.push(`<li><strong>Amount:</strong> $${escapeHtml(alert.amount)}</li>`);
  messageLines.push(`<li><strong>Transaction Date:</strong> ${escapeHtml(alert.transactionDate)}</li>`);
  messageLines.push(`<li><strong>Provider:</strong> ${escapeHtml(alert.provider)}</li>`);
  messageLines.push(`<li><strong>Reason:</strong> ${escapeHtml(alert.reasonCode || 'N/A')}</li>`);
  messageLines.push(`<li><strong>Network:</strong> ${escapeHtml(alert.subprovider || 'N/A')}</li>`);
  messageLines.push(`<li><strong>Customer Email:</strong> ${escapeHtml(alert.customerEmail || 'N/A')}</li>`);
  messageLines.push(`<li><strong>Already Refunded:</strong> ${alert.isRefunded ? 'Yes' : 'No'}</li>`);
  messageLines.push('</ul>');

  // Match & action details
  if (match) {
    messageLines.push('<strong>Match Details:</strong>');
    messageLines.push('<ul>');
    messageLines.push(`<li><strong>Method:</strong> ${escapeHtml(match.method)}</li>`);
    messageLines.push(`<li><strong>Charge:</strong> ${escapeHtml(match.chargeId || 'N/A')}</li>`);
    messageLines.push(`<li><strong>Invoice:</strong> ${escapeHtml(match.invoiceId || 'N/A')}</li>`);
    messageLines.push(`<li><strong>Subscription:</strong> ${escapeHtml(match.subscriptionId || 'N/A')}</li>`);
    messageLines.push(`<li><strong>Customer:</strong> ${escapeHtml(match.customerId || 'N/A')}</li>`);
    messageLines.push(`<li><strong>Customer Email:</strong> ${escapeHtml(match.email || 'N/A')}</li>`);
    messageLines.push(`<li><strong>UID:</strong> ${escapeHtml(match.uid || 'unknown')}</li>`);
    messageLines.push('</ul>');

    if (result) {
      messageLines.push('<strong>Actions Taken:</strong>');
      messageLines.push('<ul>');
      messageLines.push(`<li><strong>Refund:</strong> ${escapeHtml(result.refundStatus)}${result.refundId ? ` (${escapeHtml(result.refundId)})` : ''}${result.amountRefunded ? ` — $${(result.amountRefunded / 100).toFixed(2)} ${escapeHtml(result.currency || '')}` : ''}</li>`);
      messageLines.push(`<li><strong>Cancel Subscription:</strong> ${escapeHtml(result.cancelStatus)}</li>`);
      messageLines.push('</ul>');
    }
  }

  // Stripe link
  if (alert.stripeUrl) {
    messageLines.push(`<br><a href="${safeUrl(alert.stripeUrl)}">View in Stripe Dashboard</a>`);
  }

  // Errors
  if (result?.errors?.length) {
    messageLines.push('');
    messageLines.push('<strong>Errors:</strong>');
    messageLines.push('<ul>');
    result.errors.forEach((err) => {
      messageLines.push(`<li>${escapeHtml(err)}</li>`);
    });
    messageLines.push('</ul>');
  }

  return email.send({
    sender: 'internal',
    to: brandEmail,
    subject: subject,
    template: 'card',
    categories: ['order/dispute-alert'],
    copy: true,
    // Body is first-party markup built above; its third-party values are escaped.
    trustedContent: true,
    data: {
      email: {
        preview: `Dispute Alert: ${matched} — $${alert.amount} on ****${alert.card.last4}`,
      },
      content: {
        title: `Dispute Alert: ${matched}`,
        message: messageLines.join('\n'),
      },
    },
  })
    .then((r) => {
      ctx.log(`sendDisputeEmail(): Success alertId=${alertId}`);
      return 'success';
    })
    .catch((e) => {
      ctx.error(`sendDisputeEmail(): Failed alertId=${alertId}: ${e.message}`);
      return 'failed';
    });
}

// Exported for testing
module.exports.sendDisputeEmail = sendDisputeEmail;
