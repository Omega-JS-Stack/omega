/**
 * POST /admin/email - Send email via SendGrid
 *
 * Admin-only endpoint to send transactional emails.
 * Supports flexible recipient formats (string, object, UID, or arrays of mixed).
 *
 * See: src/manager/libraries/email/ for the shared email builder and sender.
 */
const prepare = require('../../../libraries/email/prepare.js');

/**
 * How many recipients a send carries, across to/cc/bcc.
 *
 * Each field is a string, an object, or an array of either — the count is all the log
 * needs, so no address is ever read out of them.
 *
 * @param {object} settings - Caller-supplied send settings
 * @returns {number} Total recipient entries
 */
function recipientCount(settings) {
  return ['to', 'cc', 'bcc'].reduce((total, field) => {
    const value = settings[field];

    if (!value) {
      return total;
    }

    return total + (Array.isArray(value) ? value.length : 1);
  }, 0);
}

module.exports = async ({ ctx, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // The raw-HTML fields are internal-caller only — this route (and the MCP
  // send_email tool that calls it) sends markdown through the escaped lane.
  const internalOnlyFault = prepare.internalOnlyFieldFault(settings);

  if (internalOnlyFault) {
    // Log the rejection so the attempt leaves a trace — the field name only, never
    // the payload it tried to smuggle.
    ctx.log(`Rejected: ${internalOnlyFault.message}`);

    return ctx.respond(internalOnlyFault.message, { code: internalOnlyFault.code });
  }

  // Check for SendGrid key
  if (!process.env.SENDGRID_API_KEY) {
    return ctx.respond('SendGrid API key not configured.', { code: 500 });
  }

  // Metadata only — never the payload. The full settings object carries every
  // recipient address and the body itself, and this line lands in Cloud Logging where
  // it outlives the send ([#127](https://github.com/Omega-JS-Stack/omega/issues/127)).
  ctx.log(`Request: recipients=${recipientCount(settings)}, template=${settings.template}, subject=${settings.subject}`);

  const email = ctx.Manager.Email(ctx);
  const result = await email.send(settings).catch(e => e);

  if (result instanceof Error) {
    return ctx.respond(result.message, { code: result.code || 500 });
  }

  return ctx.respond(result);
};
