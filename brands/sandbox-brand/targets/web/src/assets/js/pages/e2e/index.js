/**
 * The `window.__omega` hook surface the sandbox brand's cross-stack e2e lane
 * drives (test/e2e/run.js), bound to /e2e by the page-asset key — nothing
 * declares it.
 *
 * It hangs off the REAL client the framework boots: `bootPage` awaits the main
 * boot before calling this module, so `omega` is initialized and, in a dev
 * build, already connected to the local emulator suite with zero flags. That
 * is the whole point of the lane after
 * [#775](https://github.com/Omega-JS-Stack/omega/issues/775): the page under
 * test is a real @omega.js/web page served by the real `omega dev`, so the
 * steps prove the product's own boot rather than a fixture's.
 *
 * The hooks are THIN on purpose — one client call each, no logic of their own.
 * A step that fails must indict the stack, never this file.
 */

// Libraries
import omega from '@omega.js/client';
import { loadCharts, barChart, stackedBarChart, doughnutChart, lineChart } from '__main_assets__/js/libs/charts.js';

function setStatus(text) {
  const element = document.getElementById('status');
  if (element) {
    element.textContent = text;
  }
}

/**
 * Await one settled auth state ({ user, account, resolved }). Each call
 * re-fetches the account from Firestore — the lane polls this to observe the
 * user doc @omega.js/backend's auth onCreate trigger writes.
 */
function authState() {
  return new Promise((resolve) => {
    omega.auth().listen({ once: true }, resolve);
  });
}

/**
 * Draw one of each chart the framework's helper builds (#74) and report what
 * actually landed in the slot. The helper mounts an SVG host (#772), so the
 * claim is MARKS with real geometry: node compiles a scene, but only a real
 * browser lays a host out, measures its guides and paints the result — and
 * "the builder returned a host" is not the same claim as "a chart drew".
 */
async function drawCharts() {
  const box = document.createElement('div');
  box.id = 'chart-probe';
  document.body.appendChild(box);

  if (!await loadCharts()) {
    return { loaded: false };
  }

  const labels = ['Mon', 'Tue', 'Wed'];
  const values = [3, 7, 5];
  const builders = {
    bar: (id) => barChart(id, { labels, values, label: 'Signups' }),
    stacked: (id) => stackedBarChart(id, { labels, series: [{ label: 'A', values }, { label: 'B', values: [1, 2, 3] }] }),
    doughnut: (id) => doughnutChart(id, { labels, values, colors: ['var(--omega-ok)', 'var(--omega-warn)', 'var(--omega-danger)'] }),
    line: (id) => lineChart(id, { labels, series: [{ label: 'A', values }] }),
  };

  const drew = {};
  for (const [name, build] of Object.entries(builders)) {
    const id = `chart-probe-${name}`;
    const slot = document.createElement('div');
    slot.style.cssText = 'position: relative; width: 400px; height: 200px;';
    slot.innerHTML = `<div id="${id}" style="height: 100%;"></div>`;
    box.appendChild(slot);

    const host = build(id);
    // A mark the reader can see: a rect/path/circle the browser gives a real
    // box. An empty axis pair, or a bar of zero width, counts for nothing.
    const marks = [...document.getElementById(id).querySelectorAll('rect, path, circle')]
      .filter((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      }).length;

    drew[name] = { built: Boolean(host), marks };
  }

  return { loaded: true, drew };
}

// Hung at IMPORT time, before the boot handshake resolves, so the lane always
// finds the object: a client that fails to initialize never reaches the default
// export below, and `isReady` staying false with the boot's own
// `Page module error:` line in page.log is the diagnosis.
window.__omega = {
  isReady: false,
  manager: omega,
  drawCharts,

  // Signup is page-side in the real stack too: pages create the Firebase auth
  // user directly (core's own `js/libs/auth/email.js` does exactly this), and
  // @omega.js/backend's auth onCreate trigger then writes the Firestore doc.
  async signUp(email, password) {
    const { createUserWithEmailAndPassword } = await import('@firebase/auth');
    const credential = await createUserWithEmailAndPassword(omega.firebaseAuth, email, password);
    return credential.user.uid;
  },
  signIn(email, password) {
    return omega.auth().signInWithEmailAndPassword(email, password)
      .then((user) => user.uid);
  },
  // Persona signin for the lifecycle steps: the lane mints a custom token for a
  // seeded persona (admin SDK) and signs the browser in as them — the same
  // client method the real site's ?authCustomToken= param uses.
  signInWithCustomToken(token) {
    return omega.auth().signInWithCustomToken(token)
      .then((user) => user.uid);
  },
  getIdToken() {
    return omega.auth().getIdToken();
  },
  // Authenticated backend call: the signed-in user's ID token rides the
  // Authorization header, exactly what a real page does. The base URL comes
  // from the client's own getApiUrl, so a BUMPED emulator port is exercised
  // through the page chrome the dev server baked in.
  // Errors come back as plain text (the backend's wire contract), successes as
  // JSON — both surfaced so steps can assert on either.
  api(method, route, body) {
    return omega.auth().getIdToken()
      .then((token) => fetch(`${omega.getApiUrl()}/omega/${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }))
      .then((response) => response.text().then((text) => {
        let json = null;
        try { json = JSON.parse(text); } catch (error) { /* plain-text error body */ }
        return { ok: response.ok, status: response.status, json, text };
      }));
  },
  signOut() {
    return omega.auth().signOut();
  },
  currentUser() {
    return omega.auth().getUser();
  },
  authState,
};

// Module
export default () => {
  window.__omega.isReady = true;
  setStatus('ready');
};
