/**
 * Legal document page — builds the "On this page" rail from the document's
 * section headings, tracks the reading position, and wires the print action.
 * Shared by /terms, /privacy, /cookies (layout frontend/pages/legal/document).
 */

// Libraries
import omega from '@omega.js/client';

// Module
export default () => {
  return new Promise(async function (resolve) {
    await omega.dom().ready();

    buildToc();
    setupPrint();

    return resolve();
  });
};

// Build the table of contents from the document's section headings — h2 =
// primary entries, h3 = nested subsections (the legal blueprints use both).
// Headings get stable slug ids so sections are linkable; the observer marks
// the section currently in view.
function buildToc() {
  const $doc = document.querySelector('[data-legal-doc]');
  const $toc = document.querySelector('[data-legal-toc]');
  if (!$doc || !$toc) {
    return;
  }

  const $headings = [...$doc.querySelectorAll('h2, h3')];
  if (!$headings.length) {
    $toc.closest('.classy-legal__rail')?.setAttribute('hidden', '');
    return;
  }

  const seen = new Set();
  const $list = document.createElement('ol');
  $list.className = 'classy-legal__toc-list';

  $headings.forEach(($heading) => {
    if (!$heading.id) {
      let slug = $heading.textContent.trim().toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 64) || 'section';
      while (seen.has(slug)) slug = `${slug}-x`;
      seen.add(slug);
      $heading.id = slug;
    }

    const $item = document.createElement('li');
    if ($heading.tagName === 'H3') {
      $item.className = 'classy-legal__toc-sub';
    }
    const $link = document.createElement('a');
    $link.href = `#${$heading.id}`;
    $link.textContent = $heading.textContent.trim();
    $item.appendChild($link);
    $list.appendChild($item);
  });

  $toc.appendChild($list);

  // Reading-position highlight — the topmost visible section wins
  const links = new Map($headings.map(($h) => [$h.id, $list.querySelector(`a[href="#${CSS.escape($h.id)}"]`)]));
  const visible = new Set();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id);
    });

    const current = $headings.find(($h) => visible.has($h.id));
    links.forEach(($link, id) => {
      $link.classList.toggle('active', current ? id === current.id : false);
    });
  }, { rootMargin: '-10% 0px -70% 0px' });

  $headings.forEach(($h) => observer.observe($h));
}

// Print the document (the stylesheet's @media print hides the chrome)
function setupPrint() {
  document.querySelector('[data-legal-print]')?.addEventListener('click', () => {
    window.print();
  });
}
