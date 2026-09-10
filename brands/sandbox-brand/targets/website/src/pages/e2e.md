---
# The page the brand's cross-stack e2e lane opens
# (test/e2e/run.js). Its module — src/assets/js/pages/e2e/index.js, bound to
# this URL by the page-asset key, nothing declared — hangs the `window.__omega`
# hooks the lane's fifteen steps drive off the REAL client the framework boots.
# Deliberately bare: `core/root` is the shell plus the asset scripts, so a
# failing step is the stack's fault and never a section's.
layout: core/root
permalink: /e2e
meta:
  title: "Sandbox e2e"
  description: "The surface the sandbox brand's cross-stack e2e lane drives."
  index: false
---

<main class="container py-5">
  <h1>Sandbox e2e</h1>
  <p>Driven by <code>test/e2e/run.js</code> against the local stack.</p>
  <div id="status">booting</div>
</main>
