// ============================================
// Shared Floating Panel Component
// ============================================
// Reusable hovering panel for any site-specific filler.
// Each site provides its own presets, display, and fill logic.

import { createEl } from './helpers.js';

// ── Style Constants ──────────────────────────────────────────────────────

const S = {
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  bg: '#0f0f19',
  purple: '#a78bfa',
  dim: 'rgba(255,255,255,0.35)',
  border: 'rgba(255,255,255,0.08)',
};

// ── Panel ────────────────────────────────────────────────────────────────

/**
 * Show the floating filler panel.
 *
 * @param {object} options
 * @param {string}         options.panelId       - Unique DOM id for this panel
 * @param {string}         options.label         - Top-left label (e.g. "STRIPE", "PAYPAL")
 * @param {string|null}    options.activePreset  - Currently active preset key (or null)
 * @param {string[]}       options.favoriteKeys  - Ordered preset keys to show as buttons
 * @param {function}       options.onPresetClick - Called with (presetKey) when a button is clicked
 * @param {function|null}  options.renderDetails - Called with ($container) to render site-specific details.
 *                                                  If null, shows "click a preset" message.
 */
export function showPanel(options) {
  const {
    panelId,
    label,
    activePreset,
    favoriteKeys,
    onPresetClick,
    renderDetails,
  } = options;

  // Remove existing panel
  const old = document.getElementById(panelId);
  if (old) old.remove();

  // Root container
  const $panel = createEl('div', {
    position: 'fixed', top: '16px', left: '16px', zIndex: '2147483647',
    background: S.bg, color: '#e0e0e0', borderRadius: '10px',
    padding: '14px 16px', fontFamily: S.font, fontSize: '13px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
    minWidth: '260px', maxWidth: '300px', lineHeight: '1.4',
  }, { id: panelId });

  // ── Header row ─────────────────────────────────────────────────────────
  const $header = createEl('div', {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '12px', paddingBottom: '8px',
    borderBottom: `1px solid ${S.border}`,
  });
  const $headerLeft = createEl('div', { display: 'flex', alignItems: 'center', gap: '8px' });

  // Purple dot + label
  const $badge = createEl('span', {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: '11px', fontWeight: '700', color: S.purple,
    letterSpacing: '1px', textTransform: 'uppercase',
  });
  const $dot = createEl('span', {
    width: '6px', height: '6px', borderRadius: '50%',
    background: S.purple, display: 'inline-block',
  });
  $badge.appendChild($dot);
  $badge.appendChild(document.createTextNode(label));

  // Active preset pill
  const $namePill = createEl('span', {
    fontSize: '13px', fontWeight: '700', color: '#fff',
    background: 'rgba(167,139,250,0.15)', padding: '2px 8px',
    borderRadius: '4px', fontFamily: S.mono,
  }, { text: activePreset || 'ready' });

  $headerLeft.append($badge, $namePill);

  // Close button
  const $closeBtn = createEl('button', {
    cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: '18px',
    lineHeight: '1', background: 'none', border: 'none', padding: '2px 6px',
    borderRadius: '4px', fontFamily: S.font,
  }, { html: '&times;' });
  $closeBtn.addEventListener('mouseover', () => { $closeBtn.style.color = '#fff'; $closeBtn.style.background = 'rgba(255,255,255,0.1)'; });
  $closeBtn.addEventListener('mouseout', () => { $closeBtn.style.color = 'rgba(255,255,255,0.3)'; $closeBtn.style.background = 'none'; });
  $closeBtn.addEventListener('click', () => $panel.remove());

  $header.append($headerLeft, $closeBtn);
  $panel.appendChild($header);

  // ── Details area ───────────────────────────────────────────────────────
  if (renderDetails) {
    renderDetails($panel);
  } else {
    const $msg = createEl('div', {
      fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px',
      textAlign: 'center', lineHeight: '1.5',
    }, { html: 'Click a preset below to fill the form' });
    $panel.appendChild($msg);
  }

  // ── Preset quick-switch buttons ────────────────────────────────────────
  const $presets = createEl('div', { display: 'flex', flexWrap: 'wrap', gap: '4px' });

  for (const key of favoriteKeys) {
    const isActive = key === activePreset;
    const $btn = createEl('button', {
      background: isActive ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.06)',
      border: isActive ? '1px solid rgba(167,139,250,0.4)' : '1px solid rgba(255,255,255,0.1)',
      borderRadius: '5px',
      color: isActive ? '#c4b5fd' : 'rgba(255,255,255,0.5)',
      fontSize: '10px', padding: '4px 8px', cursor: 'pointer',
      fontFamily: S.mono, fontWeight: '500',
    }, { text: key });

    $btn.addEventListener('mouseover', () => {
      if (!isActive) {
        $btn.style.background = 'rgba(255,255,255,0.12)';
        $btn.style.color = '#fff';
        $btn.style.borderColor = 'rgba(255,255,255,0.25)';
      }
    });
    $btn.addEventListener('mouseout', () => {
      if (!isActive) {
        $btn.style.background = 'rgba(255,255,255,0.06)';
        $btn.style.color = 'rgba(255,255,255,0.5)';
        $btn.style.borderColor = 'rgba(255,255,255,0.1)';
      }
    });
    $btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPresetClick(key);
    });

    $presets.appendChild($btn);
  }

  $panel.appendChild($presets);
  document.body.appendChild($panel);
}

// ── Shared detail renderers ──────────────────────────────────────────────

/**
 * Render a labeled field in a grid container.
 */
export function addField($grid, label, value, full) {
  const $field = createEl('div', {
    display: 'flex', flexDirection: 'column', gap: '2px',
    ...(full ? { gridColumn: '1 / -1' } : {}),
  });
  const $lbl = createEl('span', {
    fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
    color: S.dim, fontWeight: '500',
  }, { text: label });
  const $val = createEl('span', {
    fontSize: '14px', fontWeight: '600', color: '#fff',
    fontFamily: S.mono, letterSpacing: '0.5px',
  }, { text: value });
  $field.append($lbl, $val);
  $grid.appendChild($field);
}

/**
 * Create a 2-column detail grid with margin below.
 */
export function createDetailGrid() {
  return createEl('div', {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: '6px 16px', marginBottom: '10px',
  });
}

/**
 * Render a colored outcome/status pill.
 */
export function addOutcomePill($container, text, color) {
  const outcomeBg = color + '1a'; // ~10% opacity
  const $outcome = createEl('div', {
    padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
    textAlign: 'center', fontWeight: '500', marginBottom: '10px',
    background: outcomeBg, border: `1px solid ${color}22`,
    color: color,
  }, { text });
  $container.appendChild($outcome);
}
