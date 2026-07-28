/**
 * Sandbox brand website entry — boots @omega.js/client against the emulated sandbox
 * backend and exposes the hooks the cross-stack e2e driver (../../e2e/run.js) calls.
 *
 * Configuration mirrors the brand config (config/omega.json5 at the brand root)
 * (demo-sandbox-brand, fake-by-design values). environment=development ALONE makes
 * @omega.js/client connect to the local emulator suite instead of live Firebase
 * (zero flags, N5) — the same signal `omega dev` injects via the chrome.
 */
import manager from '@omega.js/client';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { loadCharts, barChart, stackedBarChart, doughnutChart, lineChart } from '@omega.js/web-charts';

const CONFIGURATION = {
  environment: 'development',
  brand: {
    id: 'sandbox-brand',
    name: 'Sandbox Brand',
  },
  cloud: {
    provider: 'firebase',
    config: {
      apiKey: 'sandbox-api-key',
      authDomain: 'demo-sandbox-brand.firebaseapp.com',
      projectId: 'demo-sandbox-brand',
      storageBucket: 'demo-sandbox-brand.appspot.com',
      messagingSenderId: '111111111111',
      appId: '1:111111111111:web:1111111111111111111111',
    },
  },
};

function setStatus(text) {
  const element = document.getElementById('status');
  if (element) {
    element.textContent = text;
  }
}

/**
 * Await one settled auth state ({ user, account, resolved }). Each call re-fetches
 * the account from Firestore — the driver polls this to observe the user doc
 * created by @omega.js/backend's auth onCreate trigger.
 */
function authState() {
  return new Promise((resolve) => {
    manager.auth().listen({ once: true }, resolve);
  });
}

/**
 * Draw one of each chart the framework's helper builds (#74) and report what
 * actually landed on the canvas. Chart.js needs a real 2d context, so this is
 * the only place the four builders can be proven — node has no canvas, and
 * "the builder returned an object" is not the same claim as "a chart drew".
 * Pixels are the claim: a canvas with nothing painted is fully transparent.
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
    slot.innerHTML = `<canvas id="${id}"></canvas>`;
    box.appendChild(slot);

    const chart = build(id);
    const canvas = document.getElementById(id);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) painted++;
    }

    drew[name] = { built: Boolean(chart), painted };
  }

  return { loaded: true, drew };
}

window.__omega = {
  isReady: false,
  initError: null,
  manager,
  drawCharts,

  // Signup is page-side in the real stack too: pages create the Firebase auth
  // user directly; @omega.js/backend's auth onCreate trigger then creates the Firestore doc.
  signUp(email, password) {
    return createUserWithEmailAndPassword(manager.firebaseAuth, email, password)
      .then((credential) => credential.user.uid);
  },
  signIn(email, password) {
    return manager.auth().signInWithEmailAndPassword(email, password)
      .then((user) => user.uid);
  },
  // Persona signin for lifecycle e2e (N6): the driver mints a custom token for a
  // seeded persona (admin SDK) and signs the browser in as them — same client
  // method the real site's ?authCustomToken= param uses.
  signInWithCustomToken(token) {
    return manager.auth().signInWithCustomToken(token)
      .then((user) => user.uid);
  },
  getIdToken() {
    return manager.auth().getIdToken();
  },
  // Authenticated backend call for lifecycle e2e (N6): the signed-in user's ID
  // token rides the Authorization header, exactly what a real page does. Base
  // URL comes from the client's getApiUrl (N7): the harness injects the
  // resolved emulator map as window.__OMEGA_DEV_PORTS__, so this exercises the
  // map-reading branch in a real browser — http to the hosting emulator
  // (rewrites /omega/** to omega_api), bumped ports included.
  // Errors come back as plain text (the backend's wire contract), successes as
  // JSON — both surfaced so steps can assert on either.
  api(method, route, body) {
    return manager.auth().getIdToken()
      .then((token) => {
        return fetch(`${manager.getApiUrl()}/omega/${route}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      })
      .then((response) => {
        return response.text().then((text) => {
          let json = null;
          try { json = JSON.parse(text); } catch (error) { /* plain-text error body */ }
          return { ok: response.ok, status: response.status, json, text };
        });
      });
  },
  signOut() {
    return manager.auth().signOut();
  },
  currentUser() {
    return manager.auth().getUser();
  },
  authState,
};

manager.initialize(CONFIGURATION)
  .then(() => {
    window.__omega.isReady = true;
    setStatus('ready');
  })
  .catch((error) => {
    window.__omega.initError = error.message;
    setStatus(`init error: ${error.message}`);
  });
