# Directory Structure

## @omega.js/backend Library (this repo)

```
src/
  manager/
    index.js                          # Main Manager class
    helpers/                          # Helper classes
      ctx.js                    # Request/response handling
      user.js                         # User property structure + schema
      analytics.js                    # GA4 integration
      usage.js                        # Rate limiting
      middleware.js                   # Request pipeline
      settings.js                     # Schema validation
      utilities.js                    # Batch operations
      metadata.js                     # Timestamps/tags
    libraries/
      payment/                        # Shared payment utilities
        order-id.js                   # Order ID generation (XXXX-XXXX-XXXX)
        processors/                   # Payment processor libraries
          stripe.js                   # Stripe SDK init, fetchResource, toUnified*, resolvePriceId
          paypal.js                   # PayPal fetchResource, toUnified* (custom_id parsing)
          test.js                     # Test processor (delegates to Stripe shapes)
    events/                             # All event-driven code
      auth/                             # Auth event handlers (hookable)
        before-create.js                # Disposable email blocking + IP rate limiting
        before-signin.js                # Activity update + sign-in analytics
        on-create.js                    # User doc creation
        on-delete.js                    # User doc deletion + marketing cleanup
        utils.js                        # Shared utilities (retryWrite, runAuthHook)
      cron/                             # Cron job runners
        runner.js                       # Shared cron job runner (@omega.js/backend + consumer hooks)
        daily.js                        # Daily cron entry point
        daily/{job}.js                  # Individual daily cron jobs (incl. trial-lapse-sweep.js, expire-paypal-cancellations.js)
        frequent.js                     # Frequent cron entry point
        frequent/{job}.js               # Individual frequent cron jobs (incl. retry-failed-webhooks.js)
      firestore/                        # Firestore triggers
        payments-webhooks/              # Webhook processing pipeline
          on-write.js                   # Orchestrator: fetch→transform→transition→write
          analytics.js                  # Payment analytics tracking (GA4, Meta, TikTok)
          transitions/                  # State transition detection + handlers
            index.js                    # Transition detection logic
            send-email.js               # Shared email helper for handlers
            subscription/               # Subscription transition handlers
            one-time/                   # One-time payment transition handlers
    functions/core/                     # Built-in functions
      actions/
        api.js                          # Main omega_api handler
        api/{category}/{action}.js      # API command handlers
    routes/                           # Built-in routes
      admin/
        post/                         # POST /admin/post - Create blog posts via GitHub
          post.js                     # Extracts images, uploads to GitHub, rewrites body to @post/ format
          put.js                      # PUT /admin/post - Edit existing posts
          templates/
            post.html                 # Post frontmatter template
      payments/
        intent/                       # POST /payments/intent
          post.js                     # Intent creation orchestrator
          processors/                 # Per-processor intent creators
            stripe.js                 # Stripe Checkout Session creation
            paypal.js                 # PayPal subscription + one-time order creation
            test.js                   # Test processor (auto-fires webhooks)
        webhook/                      # POST /payments/webhook
          post.js                     # Webhook ingestion + Firestore write
          processors/                 # Per-processor webhook parsers
            stripe.js                 # Stripe event parsing + categorization
            paypal.js                 # PayPal event parsing + categorization
            test.js                   # Test processor (delegates to Stripe)
        cancel/                       # POST /payments/cancel
          processors/
            stripe.js                 # Stripe cancel_at_period_end
            paypal.js                 # PayPal subscription cancel
            test.js                   # Test cancel (writes webhook doc)
        refund/                       # POST /payments/refund (subscription or one-time by orderId)
          processors/
            stripe.js                 # Stripe refund + immediate cancel
            paypal.js                 # PayPal refund + cancel
            test.js                   # Test refund (writes webhook doc)
        uncancel/                     # POST /payments/uncancel (capability-gated; no PayPal)
          processors/                 # Per-processor cancellation withdrawal
        plan/                         # POST /payments/plan (plan/frequency switch)
          processors/                 # Per-processor plan switchers
        portal/                       # POST /payments/portal
          processors/
            stripe.js                 # Stripe billing portal URL
            paypal.js                 # PayPal management URL
    schemas/                          # Built-in schemas
  cli/
    index.js                          # CLI entry point
    commands/                         # CLI commands
  test/
    test-accounts.js                  # Test account definitions (static + journey)
templates/
  config/omega.json5                  # Config template
```

## Consumer Project Structure

Consumers are src-first: authored code lives in `src/`, `dist/` is staged output (gitignored, generated by `omega build`; `firebase.json` points `functions.source` + `hosting.public` at it). See [build-system.md](build-system.md).

```
package.json                          # THE app manifest: scripts + runtime deps
.env                                  # Secrets (gitignored; D15 cascade)
.nvmrc                                # Node version pin
config/omega.json5                    # App config (standalone only — brand apps carry none)
service-account.json                  # Firebase SA (standalone only — brand apps
                                      # keep it in the brand's .omega/secrets/)
src/
  index.js                            # Manager.init() + custom functions
  routes/
    {endpoint}/
      index.js                        # All methods handler
      get.js                          # GET handler
      post.js                         # POST handler
  schemas/
    {endpoint}/
      index.js                        # Schema definition
  hooks/
    auth/
      before-create.js                # Custom pre-signup checks (can block)
      before-signin.js                # Custom pre-signin checks (can block)
      on-create.js                    # Post-signup side effects (non-blocking)
      on-delete.js                    # Post-deletion side effects (non-blocking)
    cron/
      daily/
        {job}.js                      # Custom daily jobs
  public/                             # OPTIONAL: hosting boilerplate overrides
test/                                 # Project tests
firebase.json  .firebaserc           # Firebase project config
firestore.rules  database.rules.json  # Security rules
dist/                                 # GENERATED — never edit (staged by omega build)
```
