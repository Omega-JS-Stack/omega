/**
 * POST /handler/post - Create post handler (with invoice and notification)
 * Admin-only endpoint that creates invoices and sends notifications for guest posts
 */
module.exports = async ({ ctx, Manager, user, settings, analytics }) => {
  const fetch = Manager.require('wonderful-fetch');

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  const response = {
    invoice: {
      success: false,
      data: {},
    },
    notification: {
      success: false,
      data: {},
    }
  };

  const postSlug = `/blog/${settings.url}`;
  const invoiceNote = `GP to ${Manager.config.brand.name} \nSlug: ${postSlug} \n\n${settings.invoiceNote}`;

  // Create and send invoice if email and price are provided
  if (settings.invoiceEmail && settings.invoicePrice) {
    // Create invoice
    // ITW wrapper wire contract: the wrapper Cloud Function runs legacy BEM,
    // whose auth reads exactly this payload field. Flips to the
    // omega-admin-key header only when ITW's wrapper migrates to the new
    // stack — never "fix" unilaterally.
    const createdInvoice = await fetch('https://us-central1-itw-creative-works.cloudfunctions.net/wrapper', {
      method: 'POST',
      response: 'json',
      body: {
        backendManagerKey: process.env.OMEGA_ADMIN_KEY,
        method: 'post',
        service: 'paypal',
        command: 'v2/invoicing/invoices',
        body: {
          detail: {
            currency_code: 'USD',
            note: invoiceNote,
            memo: invoiceNote,
          },
          primary_recipients: [
            {
              billing_info: {
                email_address: settings.invoiceEmail,
              },
            }
          ],
          items: [
            {
              name: 'GP',
              description: `Slug: ${postSlug}`,
              quantity: '1',
              unit_amount: {
                currency_code: 'USD',
                value: `${settings.invoicePrice}`
              },
              unit_of_measure: 'QUANTITY',
            },
          ],
        }
      },
    }).catch(e => e);

    if (createdInvoice instanceof Error) {
      return ctx.respond(createdInvoice.message, { code: 500 });
    }

    // Send invoice
    const createdInvoiceId = (createdInvoice?.href ?? '').split('/').pop();
    // Send invoice — same ITW-wrapper wire pin as the create call above
    const sentInvoice = await fetch('https://us-central1-itw-creative-works.cloudfunctions.net/wrapper', {
      method: 'POST',
      response: 'json',
      body: {
        backendManagerKey: process.env.OMEGA_ADMIN_KEY,
        service: 'paypal',
        command: `v2/invoicing/invoices/${createdInvoiceId}/send`,
        method: 'post',
        body: {}
      },
    }).catch(e => e);

    if (sentInvoice instanceof Error) {
      return ctx.respond(sentInvoice.message, { code: 500 });
    }

    response.invoice = {
      success: true,
      data: sentInvoice,
    };
  }

  // Send notification (unless explicitly disabled)
  if (settings.sendNotification !== false) {
    // Use NEW API format
    await fetch(`${Manager.getApiUrl()}/omega/admin/notification`, {
      method: 'POST',
      response: 'json',
      headers: {
        'Authorization': `Bearer ${process.env.OMEGA_ADMIN_KEY}`,
      },
      body: {
        notification: {
          title: settings.title,
          body: `"${settings.title}" was just published on our blog. It's a great read and we think you'll enjoy the content!`,
          click_action: `${Manager.project.websiteUrl}/blog`,
          // brand.images stores site-relative paths — the push icon must be a
          // fetchable URL, resolved against THIS environment's website origin
          icon: Manager.config.brand.images.brandmark
            ? new URL(Manager.config.brand.images.brandmark, Manager.project.websiteUrl).href
            : undefined,
        }
      },
    }).catch(e => {
      ctx.error('Failed to send notification:', e);
    });

    response.notification = {
      success: true,
      data: {},
    };
  }

  // Track analytics
  analytics.event('handler/post', { action: 'create' });

  return ctx.respond(response);
};
