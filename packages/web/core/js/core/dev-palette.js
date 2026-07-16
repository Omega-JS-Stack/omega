// Dev palette — the yellow DEV pull-tab on the right edge (development only;
// main.js only imports this chunk when omega.isDevelopment()). One click
// opens the panel: switch between seeded emulator personas (they all share
// the fixed test password), see who you are, sign out, and jump to the dev
// surfaces. Styles are injected here so the palette costs production nothing.

// Libraries
import omega from '@omega.js/client';

// The N6 personas the backend emulator seeds on boot (packages/backend
// src/test/test-accounts.js) — localpart → label. All share TEST_PASSWORD.
const PERSONAS = [
  { localpart: '_test.admin', label: 'Admin' },
  { localpart: '_test.basic', label: 'Basic' },
  { localpart: '_test.premium-active', label: 'Premium' },
  { localpart: '_test.premium-expired', label: 'Expired' },
  { localpart: '_test.premium-suspended', label: 'Suspended' },
  { localpart: '_test.premium-cancelling', label: 'Cancelling' },
  { localpart: '_test.refunded', label: 'Refunded' },
];

// Deterministic seeded password (emulator-only accounts — public by design)
const TEST_PASSWORD = 'omega-test-password';

// Font Awesome Free "flask" (fontawesome.com/license/free — CC BY 4.0),
// inlined because this module injects at runtime (no uj_icon at this layer)
const FLASK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M288 0L128 0C110.3 0 96 14.3 96 32s14.3 32 32 32L128 215.5 7.5 426.3C2.6 435 0 444.7 0 454.7 0 486.4 25.6 512 57.3 512l333.4 0c31.6 0 57.3-25.6 57.3-57.3 0-10-2.6-19.8-7.5-28.4L320 215.5 320 64c17.7 0 32-14.3 32-32S337.7 0 320 0L288 0zM192 215.5l0-151.5 64 0 0 151.5c0 11.1 2.9 22.1 8.4 31.8l41.6 72.7-164 0 41.6-72.7c5.5-9.7 8.4-20.6 8.4-31.8z"/></svg>';

const STYLES = `
.omega-devbar-tab {
  position: fixed;
  top: 50%;
  right: 0;
  z-index: 2000;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 3.25rem;
  padding: 0;
  color: #1a1a19;
  background: #facc15;
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-right: 0;
  border-radius: 12px 0 0 12px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  transition: width 140ms ease, background 140ms ease;
}
.omega-devbar-tab:hover { background: #fde047; width: 3.125rem; }
.omega-devbar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2001;
  width: min(20rem, 90vw);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.125rem 1.125rem 1.5rem;
  overflow-y: auto;
  color: var(--omega-ink, #1a1a19);
  background: var(--omega-surface, #fff);
  border-left: 1px solid var(--omega-line, #e8e8e6);
  box-shadow: -18px 0 44px rgba(0, 0, 0, 0.14);
  transform: translateX(100%);
  transition: transform 180ms ease;
}
.omega-devbar[data-open="true"] { transform: translateX(0); }
.omega-devbar__head { display: flex; align-items: center; gap: 0.5rem; }
.omega-devbar__badge {
  padding: 0.1875rem 0.5rem;
  font: 700 0.625rem/1 var(--omega-font-ui, system-ui);
  letter-spacing: 0.12em;
  color: #1a1a19;
  background: #facc15;
  border-radius: 4px;
}
.omega-devbar__title { font-weight: 650; font-size: 0.875rem; }
.omega-devbar__close {
  margin-left: auto;
  padding: 0.125rem 0.5rem;
  font-size: 0.875rem;
  color: var(--omega-ink-muted, #6d6d6c);
  background: transparent;
  border: 1px solid var(--omega-line, #e8e8e6);
  border-radius: 6px;
  cursor: pointer;
}
.omega-devbar__label {
  font: 650 0.625rem/1 var(--omega-font-ui, system-ui);
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--omega-ink-faint, #a1a19e);
}
.omega-devbar__who {
  padding: 0.5rem 0.625rem;
  font-size: 0.8125rem;
  background: var(--omega-surface-2, #f6f6f5);
  border: 1px solid var(--omega-line, #e8e8e6);
  border-radius: 8px;
  word-break: break-all;
}
.omega-devbar__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.375rem; }
.omega-devbar__btn {
  padding: 0.4375rem 0.5rem;
  font-size: 0.78125rem;
  text-align: center;
  text-decoration: none;
  color: var(--omega-ink, #1a1a19);
  background: var(--omega-surface, #fff);
  border: 1px solid var(--omega-line-strong, #d8d8d5);
  border-radius: 8px;
  cursor: pointer;
}
.omega-devbar__btn:hover { background: var(--omega-surface-2, #f6f6f5); }
.omega-devbar__btn[data-busy="true"] { opacity: 0.55; pointer-events: none; }
.omega-devbar__note { font-size: 0.6875rem; color: var(--omega-ink-faint, #a1a19e); }
`;

/**
 * The brand's persona email domain (personas are seeded against the brand
 * host — playground.omegajs.dev for the playground).
 * @returns {string}
 */
function personaDomain() {
  try {
    return new URL(omega.config.brand?.url || '').hostname;
  } catch {
    return window.location.hostname;
  }
}

/**
 * Build one panel section: label + node.
 */
function section(doc, label, node) {
  const wrap = doc.createElement('div');
  const heading = doc.createElement('div');
  heading.className = 'omega-devbar__label';
  heading.textContent = label;
  heading.style.marginBottom = '0.375rem';
  wrap.append(heading, node);
  return wrap;
}

/**
 * Boot the palette (called from main.js in development only).
 */
export default function devPalette() {
  const doc = document;
  if (doc.querySelector('.omega-devbar-tab')) {
    return; // idempotent
  }

  const style = doc.createElement('style');
  style.textContent = STYLES;
  doc.head.appendChild(style);

  // The pull tab — the flask, not a text label
  const tab = doc.createElement('button');
  tab.type = 'button';
  tab.className = 'omega-devbar-tab';
  tab.innerHTML = FLASK_SVG;
  tab.setAttribute('aria-label', 'Open the dev palette');
  tab.title = 'Dev palette';

  // The panel
  const panel = doc.createElement('aside');
  panel.className = 'omega-devbar';
  panel.setAttribute('aria-label', 'Dev palette');

  const head = doc.createElement('div');
  head.className = 'omega-devbar__head';
  const badge = doc.createElement('span');
  badge.className = 'omega-devbar__badge';
  badge.textContent = 'DEV';
  const title = doc.createElement('span');
  title.className = 'omega-devbar__title';
  title.textContent = 'Palette';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'omega-devbar__close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close the dev palette');
  head.append(badge, title, close);

  // Who am I
  const who = doc.createElement('div');
  who.className = 'omega-devbar__who';
  who.textContent = 'Checking auth…';

  // Persona switcher
  const domain = personaDomain();
  const personaGrid = doc.createElement('div');
  personaGrid.className = 'omega-devbar__grid';
  PERSONAS.forEach((persona) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'omega-devbar__btn';
    button.textContent = persona.label;
    button.title = `${persona.localpart}@${domain}`;
    button.addEventListener('click', async () => {
      button.dataset.busy = 'true';
      try {
        await omega.auth().signInWithEmailAndPassword(`${persona.localpart}@${domain}`, TEST_PASSWORD);
        window.location.reload();
      } catch (error) {
        button.dataset.busy = 'false';
        who.textContent = `✕ ${error.message} — is the backend emulator running? (npm run emulator)`;
      }
    });
    personaGrid.appendChild(button);
  });

  const signOut = doc.createElement('button');
  signOut.type = 'button';
  signOut.className = 'omega-devbar__btn';
  signOut.textContent = 'Sign out';
  signOut.style.marginTop = '0.375rem';
  signOut.style.width = '100%';
  signOut.addEventListener('click', async () => {
    try {
      await omega.auth().signOut();
      window.location.reload();
    } catch (error) {
      who.textContent = `✕ ${error.message}`;
    }
  });

  // Quick links
  const links = doc.createElement('div');
  links.className = 'omega-devbar__grid';
  [
    ['Components', '/test/components'],
    ['Admin', '/admin/dashboard'],
    ['Account', '/account'],
    ['Emulator UI', 'http://127.0.0.1:4050'],
  ].forEach(([label, href]) => {
    const link = doc.createElement('a');
    link.className = 'omega-devbar__btn';
    link.textContent = label;
    link.href = href;
    if (href.startsWith('http')) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    links.appendChild(link);
  });

  const note = doc.createElement('p');
  note.className = 'omega-devbar__note';
  note.textContent = `Personas are seeded by the backend emulator (npm run emulator) against ${domain}; they all use the shared test password.`;

  panel.append(
    head,
    section(doc, 'Signed in as', who),
    section(doc, 'Switch account', personaGrid),
    signOut,
    section(doc, 'Go to', links),
    note,
  );

  const setOpen = (open) => {
    panel.dataset.open = String(open);
    tab.style.display = open ? 'none' : '';
  };
  tab.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.dataset.open === 'true') {
      setOpen(false);
    }
  });

  doc.body.append(tab, panel);

  // Live auth readout
  omega.auth().listen({}, () => {
    const user = omega.auth().getUser();
    who.textContent = user?.email || 'Signed out';
  });
}
