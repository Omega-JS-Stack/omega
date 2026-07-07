/**
 * Animation Studio — UJM default admin page
 *
 * Uses FormManager for sidebar controls. Canvas content is designed at a
 * base resolution (960×540) and CSS-scaled to match the selected resolution,
 * so clips look identical at any size.
 */

import webManager from 'web-manager';
import { FormManager } from '__main_assets__/js/libs/form-manager.js';

const BASE_W = 960;
const BASE_H = 540;

let currentClip = null;
let loopTimer = null;
let paused = false;
let speed = 1;
let clips = {};
let recording = false;
let formManager = null;

export default () => {
  return new Promise(async function (resolve) {
    await webManager.dom().ready();

    webManager.auth().listen({ once: true }, (auth) => {
      if (!auth.user) {
        return;
      }

      clips = window.STUDIO_CLIPS || {};

      const clipIds = Object.keys(clips);
      if (clipIds.length === 0) {
        const $studio = document.getElementById('studio');
        if ($studio) {
          $studio.hidden = false;
          $studio.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:rgba(255,255,255,0.5);font-size:1.1rem">No clips registered. Set <code style="color:#fff;margin:0 6px">window.STUDIO_CLIPS</code> in your project JS.</div>';
        }
        return;
      }

      buildNav(clipIds);
      setupForm();
      setupRecord();

      document.getElementById('studio').hidden = false;
      updateCanvasSize();

      currentClip = clipIds[0];
      playClip(currentClip);
    });

    return resolve();
  });
};

// ============================================
// Navigation — built from registered clips
// ============================================
function buildNav(clipIds) {
  const $container = document.getElementById('studio-clips');
  if (!$container) {
    return;
  }

  clipIds.forEach((id, i) => {
    const $btn = document.createElement('button');
    $btn.className = 'studio-clip-btn' + (i === 0 ? ' active' : '');
    $btn.dataset.clip = id;
    $btn.textContent = clips[id].label || id;
    $container.appendChild($btn);

    $btn.addEventListener('click', () => {
      if (recording) {
        return;
      }
      document.querySelector('.studio-clip-btn.active')?.classList.remove('active');
      $btn.classList.add('active');
      currentClip = id;
      if (!paused) {
        playClip(currentClip);
      }
    });
  });
}

// ============================================
// FormManager for sidebar controls
// ============================================
function setupForm() {
  formManager = new FormManager('#studio-controls-form', {
    autoReady: true,
    allowResubmit: true,
  });

  // Aspect ratio buttons
  document.querySelectorAll('.studio-aspect-btn').forEach($btn => {
    $btn.addEventListener('click', () => {
      if (recording) {
        return;
      }
      document.querySelector('.studio-aspect-btn.active')?.classList.remove('active');
      $btn.classList.add('active');

      const $canvas = document.getElementById('studio-canvas');
      if ($canvas) {
        $canvas.setAttribute('data-aspect', $btn.dataset.aspect);
      }

      updateCanvasSize();
      playClip(currentClip);
    });
  });

  // Pause slider
  const $pause = document.getElementById('studio-pause');
  const $pauseVal = document.getElementById('studio-pause-val');
  $pause?.addEventListener('input', () => {
    $pauseVal.textContent = $pause.value;
  });

  // Speed select
  const $speed = document.getElementById('studio-speed');
  $speed?.addEventListener('change', () => {
    speed = parseFloat($speed.value);
  });

  // Resolution select
  const $res = document.getElementById('studio-resolution');
  $res?.addEventListener('change', () => {
    updateCanvasSize();
    playClip(currentClip);
  });

  // Play/pause toggle
  const $toggle = document.getElementById('studio-toggle');
  $toggle?.addEventListener('click', () => {
    if (recording) {
      return;
    }
    paused = !paused;
    $toggle.textContent = paused ? '▶ Play' : '⏸ Pause';
    if (!paused) {
      playClip(currentClip);
    }
  });
}

// ============================================
// Canvas sizing + content scaling
// ============================================
function getResolution() {
  const $res = document.getElementById('studio-resolution');
  const val = $res?.value || '1920x1080';
  const [w, h] = val.split('x').map(Number);
  return { w, h };
}

function updateCanvasSize() {
  const $canvas = document.getElementById('studio-canvas');
  if (!$canvas) {
    return;
  }

  const aspect = $canvas.getAttribute('data-aspect');
  const { w, h } = getResolution();

  let cw, ch;
  if (aspect === '9:16') {
    ch = h;
    cw = Math.round(h * 9 / 16);
  } else {
    cw = w;
    ch = h;
  }

  // Canvas is always rendered at base size, then CSS-scaled
  const baseW = aspect === '9:16' ? Math.round(BASE_H * 9 / 16) : BASE_W;
  const baseH = BASE_H;
  const scaleX = cw / baseW;
  const scaleY = ch / baseH;

  $canvas.style.width = baseW + 'px';
  $canvas.style.height = baseH + 'px';
  $canvas.style.transform = `scale(${scaleX}, ${scaleY})`;
  $canvas.style.transformOrigin = 'center center';
  $canvas.setAttribute('data-size', `${cw} × ${ch}`);
}

// ============================================
// Clip runner — delay BEFORE animation
// ============================================
function playClip(clipId) {
  clearTimeout(loopTimer);
  const $canvas = document.getElementById('studio-canvas');
  if (!$canvas) {
    return;
  }

  $canvas.innerHTML = '';

  const clip = clips[clipId];
  if (!clip) {
    return;
  }

  const pauseMs = parseInt(document.getElementById('studio-pause')?.value || 1500);
  const totalDuration = clip.duration / speed;

  loopTimer = setTimeout(() => {
    clip.build($canvas, getHelpers($canvas));

    loopTimer = setTimeout(() => {
      if (!paused && currentClip === clipId && !recording) {
        playClip(clipId);
      }
    }, totalDuration);
  }, pauseMs);
}

// ============================================
// Recording
// ============================================
function setupRecord() {
  const $btn = document.getElementById('studio-record');
  if (!$btn) {
    return;
  }

  $btn.addEventListener('click', () => {
    if (recording) {
      return;
    }
    recordClip();
  });
}

async function recordClip() {
  const $canvas = document.getElementById('studio-canvas');
  const $btn = document.getElementById('studio-record');
  const $fieldset = document.getElementById('studio-fieldset');
  const clip = clips[currentClip];
  if (!$canvas || !clip) {
    return;
  }

  console.log(`[Studio] Recording clip: ${currentClip}`);

  recording = true;
  paused = true;
  clearTimeout(loopTimer);

  // Disable all controls via fieldset
  if ($fieldset) {
    $fieldset.disabled = true;
  }
  // Keep record button enabled to show state
  $btn.disabled = false;
  $btn.classList.add('recording');
  $btn.textContent = '⏺ Recording...';

  let stream;
  try {
    console.log('[Studio] Requesting screen capture...');
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 60 } },
      preferCurrentTab: true,
    });
    console.log('[Studio] Screen capture granted');
  } catch (err) {
    console.warn('[Studio] Screen capture denied:', err.message);
    resetRecordState($btn, $fieldset);
    return;
  }

  // Attempt Region Capture (CropTarget) to scope to canvas element
  try {
    if (typeof CropTarget !== 'undefined' && stream.getVideoTracks()[0].cropTo) {
      const cropTarget = await CropTarget.fromElement($canvas);
      await stream.getVideoTracks()[0].cropTo(cropTarget);
      console.log('[Studio] CropTarget applied — recording canvas only');
    } else {
      console.log('[Studio] CropTarget not available — recording full tab');
    }
  } catch (err) {
    console.log('[Studio] CropTarget failed:', err.message, '— recording full tab');
  }

  const mimeType = getSupportedMimeType();
  console.log(`[Studio] Using mime type: ${mimeType}`);

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 16_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
      console.log(`[Studio] Chunk received: ${(e.data.size / 1024).toFixed(1)}KB (${chunks.length} total)`);
    }
  };

  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());

    const ext = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const aspect = $canvas.getAttribute('data-aspect') || '16-9';
    const { w, h } = getResolution();
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const filename = `${currentClip}-${aspect.replace(':', 'x')}-${w}x${h}.${ext}`;

    console.log(`[Studio] Recording complete — ${chunks.length} chunks, ${(blob.size / 1024).toFixed(1)}KB, mime: ${recorder.mimeType}`);
    console.log(`[Studio] Downloading: ${filename}`);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    resetRecordState($btn, $fieldset);
    playClip(currentClip);
  };

  recorder.onerror = (e) => {
    console.error('[Studio] Recorder error:', e.error);
  };

  stream.getVideoTracks()[0].addEventListener('ended', () => {
    console.log('[Studio] Screen sharing ended by user');
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  });

  // Clear canvas, enter recording mode, settle
  $canvas.innerHTML = '';
  $canvas.classList.add('recording');
  await sleep(1000);
  console.log('[Studio] Canvas settled, starting recorder...');

  await new Promise((resolve) => {
    recorder.onstart = () => {
      console.log('[Studio] Recorder started');
      resolve();
    };
    recorder.start(100);
  });

  const pauseMs = parseInt(document.getElementById('studio-pause')?.value || 1500);
  const totalDuration = clip.duration / speed;

  console.log(`[Studio] Pre-delay: ${pauseMs}ms, clip duration: ${totalDuration}ms (speed: ${speed}x)`);

  await sleep(pauseMs);

  console.log('[Studio] Building clip animation...');
  clip.build($canvas, getHelpers($canvas));

  await sleep(totalDuration);

  console.log('[Studio] Clip finished, stopping recorder...');
  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
}

function resetRecordState($btn, $fieldset) {
  recording = false;
  paused = false;
  $btn.classList.remove('recording');
  $btn.textContent = '⏺ Record';

  if ($fieldset) {
    $fieldset.disabled = false;
  }

  const $canvas = document.getElementById('studio-canvas');
  if ($canvas) {
    $canvas.classList.remove('recording');
  }

  const $toggle = document.getElementById('studio-toggle');
  if ($toggle) {
    $toggle.textContent = '⏸ Pause';
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'video/webm';
}

// ============================================
// Helpers — passed to clip build() functions
// ============================================
function getHelpers($canvas) {
  return { animate, el, flowClip: (opts) => buildFlowClip($canvas, opts), cardClip: (opts) => buildCardClip($canvas, opts), chatClip: (opts) => buildChatClip($canvas, opts) };
}

function animate(element, keyframes, options = {}) {
  const delay = (options.delay || 0) / speed;
  const duration = (options.duration || 500) / speed;
  const fill = options.fill || 'forwards';
  const easing = options.easing || 'cubic-bezier(0.34, 1.56, 0.64, 1)';

  return element.animate(keyframes, { delay, duration, fill, easing });
}

function el(tag, classes, html) {
  const node = document.createElement(tag);
  if (classes) {
    node.className = classes;
  }
  if (html) {
    node.innerHTML = html;
  }
  return node;
}

// ============================================
// Builder helpers — reusable clip patterns
// ============================================
function buildFlowClip($c, { title, nodes }) {
  const isV = $c.getAttribute('data-aspect') === '9:16';

  const titleEl = el('div', 's-hero-title text-center px-3');
  titleEl.innerHTML = `<span class="s-display d-block fw-bold">${title}</span>`;
  $c.appendChild(titleEl);

  const arrow = isV ? '↓' : '→';
  const flow = el('div', `s-hidden d-flex align-items-center justify-content-center gap-3 px-4 ${isV ? 'flex-column' : ''}`);

  nodes.forEach((n, i) => {
    if (i > 0) {
      flow.appendChild(el('span', 's-hidden s-accent fw-bold fs-4 flex-shrink-0', arrow));
    }
    const node = el('div', 's-hidden card rounded-4 p-3 text-center');
    node.style.width = '140px';
    node.innerHTML = `
      <span class="d-block fs-4 mb-2">${n.icon}</span>
      <span class="d-block fw-bold small">${n.label}</span>
      <small class="d-block font-monospace text-body-secondary" style="font-size:0.65rem">${n.stat}</small>
    `;
    flow.appendChild(node);
  });

  $c.appendChild(flow);

  animate(titleEl, [
    { opacity: 0, transform: 'translateY(-20px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 600 });

  animate(flow, [{ opacity: 0 }, { opacity: 1 }], { delay: 300, duration: 300, easing: 'ease' });

  flow.querySelectorAll('.card').forEach((node, i) => {
    animate(node, [
      { opacity: 0, transform: 'scale(0.5) translateY(20px)' },
      { opacity: 1, transform: 'scale(1) translateY(0)' },
    ], { delay: 500 + i * 250, duration: 500 });
  });

  flow.querySelectorAll('.s-accent').forEach((a, i) => {
    animate(a, [{ opacity: 0 }, { opacity: 1 }], { delay: 650 + i * 250, duration: 300, easing: 'ease' });
  });
}

function buildCardClip($c, { badge, title, contentFn }) {
  const card = el('div', 's-hidden card rounded-4 p-4');
  card.style.maxWidth = '500px';
  card.style.width = '90%';
  card.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-3">${badge}</div>
    <div class="s-display fs-5 fw-bold mb-3">${title}</div>
    <div class="d-flex flex-column gap-2" data-content></div>
  `;
  $c.appendChild(card);

  animate(card, [
    { opacity: 0, transform: 'scale(0.8) translateY(30px)' },
    { opacity: 1, transform: 'scale(1) translateY(0)' },
  ], { duration: 600 });

  contentFn(card.querySelector('[data-content]'), { animate, el });
}

function buildChatClip($c, { header, messages }) {
  const headerEl = el('div', 's-hidden text-center px-3');
  headerEl.innerHTML = header;
  $c.appendChild(headerEl);

  animate(headerEl, [
    { opacity: 0, transform: 'translateY(-20px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 500 });

  const chat = el('div', 'd-flex flex-column gap-2 px-4 w-100');
  chat.style.maxWidth = '480px';

  messages.forEach((m, i) => {
    const isAI = m.type === 'ai';
    const bubble = el('div', `s-hidden rounded-4 px-3 py-2 small lh-sm ${isAI ? 's-bubble-ai align-self-end' : 's-bubble-them align-self-start'}`);
    bubble.style.maxWidth = '85%';
    bubble.innerHTML = m.text + (m.label ? `<span class="s-chat-label d-block text-uppercase mt-1">${m.label}</span>` : '');
    chat.appendChild(bubble);

    animate(bubble, [
      { opacity: 0, transform: 'translateY(16px) scale(0.92)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { delay: 800 + i * 800, duration: 500 });
  });

  $c.appendChild(chat);
}
