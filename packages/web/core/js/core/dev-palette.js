// Dev palette — the yellow DEV pull-tab on the right edge (development only;
// main.js only imports this chunk when omega.isDevelopment()). One click
// opens the panel: switch between seeded emulator personas (they all share
// the fixed test password), see who you are, sign out, and jump to the dev
// surfaces. Styles are injected here so the palette costs production nothing.
//
// Pages add their own controls through the registry (#234): whatever a page
// registered by the time you OPEN the panel is rendered after the built-ins,
// merged into a built-in section when it reuses its id.

// Libraries
import omega from '@omega.js/client';
import { getDevSections } from '__main_assets__/js/core/dev-sections.js';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('dev-palette');

// Deterministic seeded password (emulator-only accounts — public by design)
const TEST_PASSWORD = 'omega-test-password';

// How long the palette waits before asking the emulator for the roster again
// (#402). Gentle on purpose: an emulator boot takes seconds, and this is a
// background poll on a surface nobody is staring at.
const ROSTER_RETRY_MS = 2000;

// Font Awesome Free "flask" (fontawesome.com/license/free — CC BY 4.0),
// inlined because this module injects at runtime (no omega_icon at this layer)
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
.omega-devbar__starting {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  font-size: 0.78125rem;
  color: var(--omega-ink-muted, #6d6d6c);
  background: var(--omega-surface-2, #ececeb);
  border: 1px solid var(--omega-line, #e8e8e6);
  border-radius: 8px;
}
.omega-devbar__starting[hidden] { display: none; }
.omega-devbar__spinner {
  flex: none;
  width: 0.875rem;
  height: 0.875rem;
  border: 2px solid var(--omega-line-strong, #d8d8d5);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: omega-devbar-spin 700ms linear infinite;
}
@keyframes omega-devbar-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .omega-devbar__spinner { animation: none; }
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
  background: var(--omega-surface-2, #ececeb);
  border: 1px solid var(--omega-line, #e8e8e6);
  border-radius: 8px;
  word-break: break-all;
  white-space: pre-line;
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
.omega-devbar__btn:hover { background: var(--omega-surface-2, #ececeb); }
.omega-devbar__btn[data-busy="true"],
.omega-devbar__select[data-busy="true"] { opacity: 0.55; pointer-events: none; }
.omega-devbar__note { font-size: 0.6875rem; color: var(--omega-ink-faint, #a1a19e); }
.omega-devbar__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4375rem 0.5rem;
  font-size: 0.78125rem;
  background: var(--omega-surface, #fff);
  border: 1px solid var(--omega-line-strong, #d8d8d5);
  border-radius: 8px;
  cursor: pointer;
}
.omega-devbar__section { display: flex; flex-direction: column; gap: 0.375rem; }
.omega-devbar__extras { display: contents; }
.omega-devbar__fields { display: flex; flex-direction: column; gap: 0.375rem; }
.omega-devbar__field { display: flex; flex-direction: column; gap: 0.1875rem; }
.omega-devbar__field-label {
  font-size: 0.6875rem;
  color: var(--omega-ink-muted, #6d6d6c);
}
.omega-devbar__select {
  padding: 0.3125rem 1.75rem 0.3125rem 0.5rem;
  font-size: 0.78125rem;
  color: var(--omega-ink, #1a1a19);
  background: var(--omega-surface, #fff);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%236d6d6c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 0.625rem auto;
  border: 1px solid var(--omega-line-strong, #d8d8d5);
  border-radius: 6px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.omega-devbar__select:focus-visible {
  outline: 2px solid var(--omega-accent, currentColor);
  outline-offset: 2px;
}
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
 * Is this the email of a seeded persona? Only those may be reset — the reset
 * route deletes and recreates the account, so it refuses anything else anyway.
 * @param {string} email
 * @returns {boolean}
 */
function isPersona(email) {
  return (email || '').startsWith('_test.');
}

/**
 * Build one panel section: label + node. The wrap spaces its children with a
 * gap rather than the heading carrying a bottom margin, because a section can
 * hold more than one node once a page merges its own controls in (#234).
 */
function section(doc, label, node) {
  const wrap = doc.createElement('div');
  wrap.className = 'omega-devbar__section';
  const heading = doc.createElement('div');
  heading.className = 'omega-devbar__label';
  heading.textContent = label;
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

  // The waiting state (#402). A dev page routinely loads before the emulator
  // has finished booting, and one failed roster fetch used to leave a static
  // error line that never came back. This sits at the top of the panel for as
  // long as the roster is unreachable, and it MOVES: a surface that is waiting
  // says so with an animation, never with bare text (docs/shared/theming.md).
  // The spinner is drawn here rather than borrowed from Bootstrap because the
  // palette injects every style it uses.
  const starting = doc.createElement('div');
  starting.className = 'omega-devbar__starting';
  starting.hidden = true;
  starting.setAttribute('role', 'status');
  const spinner = doc.createElement('span');
  spinner.className = 'omega-devbar__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const startingNote = doc.createElement('span');
  startingNote.textContent = 'Backend starting…';
  starting.append(spinner, startingNote);

  // Who am I. The line is COMPOSED, never written to directly: auth settles on
  // its own schedule, and an identity delivered after something failed used to
  // land on top of the explanation. With no emulator up, the roster fetch
  // rejects immediately and auth answers "Signed out" a moment later, which is
  // exactly the moment the panel has the most to say (#400).
  const who = doc.createElement('div');
  who.className = 'omega-devbar__who';
  let identity = 'Checking auth…';
  let failure = null;

  const renderWho = () => {
    who.textContent = failure
      ? `${identity}\n✕ ${failure}. Is the backend emulator running? (npm run emulator)`
      : identity;
  };

  renderWho();

  // Persona switcher — one dropdown rather than a grid of buttons, so the list
  // can grow without the panel turning into a wall of them. The placeholder is
  // what you see when you are signed in as anybody but a persona. The list
  // itself is the SEED's ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
  // it arrives from the emulator below, and the palette keeps no copy of it.
  const domain = personaDomain();
  const personaSelect = doc.createElement('select');
  personaSelect.className = 'omega-devbar__select';
  personaSelect.setAttribute('aria-label', 'Switch account');
  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  // Explicitly selected: the browser's initial-selection skips disabled
  // options, which would show the first PERSONA before auth has settled.
  placeholder.selected = true;
  placeholder.textContent = 'Switch account…';
  personaSelect.appendChild(placeholder);
  personaSelect.addEventListener('change', async () => {
    const localpart = personaSelect.value;
    if (!localpart) {
      return;
    }

    personaSelect.dataset.busy = 'true';
    try {
      await omega.auth().signInWithEmailAndPassword(`${localpart}@${domain}`, TEST_PASSWORD);
      window.location.reload();
    } catch (error) {
      personaSelect.dataset.busy = 'false';
      failure = error.message;
      renderWho();
    }
  });

  // The roster the dropdown offers, as the backend handed it over. Held onto
  // because the dropdown reads as STATE too: the option that matches the
  // signed-in persona is the selected one, and auth can settle before or after
  // the roster lands.
  let personas = [];

  const syncSelection = () => {
    const localpart = (omega.auth().getUser()?.email || '').split('@')[0];
    personaSelect.value = personas.some((persona) => persona.localpart === localpart) ? localpart : '';
  };

  // The seed OWNS the list ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
  // the backend labels its human-facing personas (`palette` in
  // src/test/test-accounts.js) and hands them over here, so a persona seeded
  // today is switchable today. There is deliberately no fallback list: a
  // roster the emulator cannot answer leaves the placeholder standing alone
  // and says why, exactly as every other control here reports it.
  // `auth: false` because the roster is read BEFORE anybody is signed in: the
  // route wants no token, and asking for one warns about the Authorization
  // header it could not attach on every signed-out dev page load.
  const loadPersonas = async () => {
    try {
      const roster = await omega.request('/omega/test/roster', { auth: false });
      personas = roster?.personas || [];

      personas.forEach((persona) => {
        const option = doc.createElement('option');
        option.value = persona.localpart;
        option.textContent = persona.label;
        option.title = `${persona.localpart}@${domain}`;
        personaSelect.appendChild(option);
      });

      syncSelection();

      // An attempt that lands after one that did not clears what the waiting
      // state put on screen: the emulator is up, so both the indicator and the
      // "is it running?" explanation are stale.
      if (!starting.hidden) {
        starting.hidden = true;
        failure = null;
        renderWho();
      }
    } catch (error) {
      failure = error.message;
      renderWho();
      starting.hidden = false;

      // Retry until the emulator answers — a dev page opened during `npm run
      // emulator` should fill itself in rather than need a reload. Scheduled
      // one attempt at a time (never an interval), so a slow answer can never
      // stack fetches on top of each other. Through `window` because that is
      // the runtime seam the harness owns.
      window.setTimeout(loadPersonas, ROSTER_RETRY_MS);
    }
  };

  // Reset to seed — ONE control on the account you are signed in as (#215).
  // A journey mutates its persona; this puts it back to the shape the backend
  // seeded, user doc and purchase record alike, without an emulator reboot.
  // Only personas can be reset, so it stays hidden for anybody else.
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.className = 'omega-devbar__btn';
  reset.textContent = 'Reset to seed';
  reset.hidden = true;
  reset.style.marginTop = '0.375rem';
  reset.style.width = '100%';
  reset.addEventListener('click', async () => {
    const email = omega.auth().getUser()?.email;
    if (!email) {
      return;
    }

    reset.dataset.busy = 'true';
    try {
      await omega.request('/omega/test/reset-account', { method: 'POST' });
      // The reset recreates the auth user, which kills this session — sign the
      // same persona straight back in before reloading onto its seeded state.
      await omega.auth().signInWithEmailAndPassword(email, TEST_PASSWORD);
      window.location.reload();
    } catch (error) {
      reset.dataset.busy = 'false';
      failure = error.message;
      renderWho();
    }
  });

  // Sign out rides the SHARED trigger (#16) — the class IS the wiring, so the
  // palette can never drift from what a real sign-out button does.
  const signOut = doc.createElement('button');
  signOut.type = 'button';
  signOut.className = 'omega-devbar__btn omega-signout';
  signOut.textContent = 'Sign out';
  signOut.style.marginTop = '0.375rem';
  signOut.style.width = '100%';

  // Storage (#390) — the client blob QA pokes at by hand. ONE row (Ian
  // 2026-08-20): a target dropdown (All first, then every top-level key,
  // re-read from the LIVE blob each time the panel opens, so a key a page
  // wrote a second ago is already listed) and the two verbs, Log and Clear,
  // acting on whatever the dropdown says. No confirmations — the whole
  // surface is development-only.
  const storage = doc.createElement('div');
  storage.className = 'omega-devbar__fields';

  const storageTarget = doc.createElement('select');
  storageTarget.className = 'omega-devbar__select';
  storageTarget.setAttribute('aria-label', 'Storage target');

  const renderStorage = () => {
    const keys = Object.keys(omega.storage().get() || {});
    const previous = storageTarget.value;
    storageTarget.replaceChildren();

    const all = doc.createElement('option');
    all.value = '';
    all.textContent = `All (${keys.length} ${keys.length === 1 ? 'key' : 'keys'})`;
    storageTarget.append(all);

    keys.forEach((key) => {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = key;
      storageTarget.append(option);
    });

    // A re-render keeps the selection while its key still exists; a cleared
    // key falls back to All, which is the empty value.
    storageTarget.value = keys.includes(previous) ? previous : '';
  };

  const logStorage = doc.createElement('button');
  logStorage.type = 'button';
  logStorage.className = 'omega-devbar__btn';
  logStorage.textContent = 'Log';
  logStorage.addEventListener('click', () => {
    const key = storageTarget.value;
    // The parsed value, never a JSON string — devtools renders it explorable.
    // An ARRAY path, not the bare string: storage paths are lodash paths, and
    // a top-level key carrying a dot would otherwise read a nested one.
    if (key) {
      logger.log(`storage.${key}:`, omega.storage().get([key]));
    } else {
      logger.log('storage:', omega.storage().get());
    }
  });

  const clearStorage = doc.createElement('button');
  clearStorage.type = 'button';
  clearStorage.className = 'omega-devbar__btn';
  clearStorage.textContent = 'Clear';
  clearStorage.addEventListener('click', () => {
    const key = storageTarget.value;
    if (key) {
      // The same array-path rule as Log, for the same dotted-key reason.
      omega.storage().remove([key]);
    } else {
      omega.storage().clear();
    }
    renderStorage();
  });

  const storageActions = doc.createElement('div');
  storageActions.className = 'omega-devbar__grid';
  storageActions.append(logStorage, clearStorage);
  storage.append(storageTarget, storageActions);

  // Quick links
  const links = doc.createElement('div');
  links.className = 'omega-devbar__grid';
  [
    ['Components', '/test/components'],
    ['Admin', '/admin'],
    ['Account', '/dashboard/account'],
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

  // The sections the palette owns, by id — a page that registers under one of
  // these ids merges into it rather than repeating its heading (#234).
  const builtIns = new Map();
  const builtIn = (id, label, node) => {
    const wrap = section(doc, label, node);
    builtIns.set(id, wrap);
    return wrap;
  };

  // Where a registered section that matches no built-in lands: after the
  // palette's own sections, before the quick links.
  const extras = doc.createElement('div');
  extras.className = 'omega-devbar__extras';

  panel.append(
    head,
    starting,
    builtIn('auth', 'Signed in as', who),
    builtIn('personas', 'Switch account', personaSelect),
    reset,
    signOut,
    builtIn('storage', 'Storage', storage),
    extras,
    builtIn('links', 'Go to', links),
    note,
  );

  // Page-scoped sections (#234) are built on OPEN, not at boot: a page module
  // loads on its own schedule, and the palette must pick up whatever has
  // registered by the time you actually look. Once each — reopening the panel
  // must not stack duplicates.
  const rendered = new Set();
  const renderDevSections = () => {
    getDevSections().forEach((entry) => {
      if (rendered.has(entry.id)) {
        return;
      }
      rendered.add(entry.id);

      const node = entry.buildNode(doc);
      const host = builtIns.get(entry.id);
      if (host) {
        host.append(node);
      } else {
        extras.append(section(doc, entry.title, node));
      }
    });
  };

  const setOpen = (open) => {
    panel.dataset.open = String(open);
    tab.style.display = open ? 'none' : '';

    if (open) {
      renderStorage();
      renderDevSections();
    }
  };
  tab.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.dataset.open === 'true') {
      setOpen(false);
    }
  });

  doc.body.append(tab, panel);

  // The panel is on screen before the roster is: the dropdown fills in when the
  // emulator answers, which is the only place the list exists.
  loadPersonas();

  // Live auth readout
  omega.auth().listen({}, () => {
    const user = omega.auth().getUser();
    identity = user?.email || 'Signed out';
    renderWho();
    reset.hidden = !isPersona(user?.email);

    // The dropdown reads as state, not just a menu: it shows the persona you
    // are actually signed in as, and falls back to the placeholder for anybody
    // else (a real account, signed out, a persona the seed does not offer)
    syncSelection();
  });
}
