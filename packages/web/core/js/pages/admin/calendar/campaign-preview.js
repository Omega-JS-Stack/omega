/**
 * Campaign Preview
 * Renders email (markdown) and push (mobile frame) previews
 * for the campaign editor modal.
 */

import omega from '@omega.js/client';

// Lazy-loaded markdown-it instance
let md = null;

/**
 * Render email campaign preview HTML.
 * Lazy-loads markdown-it on first call.
 */
async function renderEmailPreview(formData) {
  const campaign = formData.campaign || {};
  const subject = campaign.subject || '';
  const preheader = campaign.preheader || '';
  const content = campaign.content || '';

  // Lazy-load markdown-it
  if (!md) {
    const MarkdownIt = (await import('markdown-it')).default;
    md = new MarkdownIt({ html: true, breaks: true, linkify: true });
  }

  const DOMPurify = (await import('dompurify')).default;
  const renderedContent = content
    ? DOMPurify.sanitize(md.render(content), {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'blockquote', 'pre', 'code', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'sup', 'sub'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'class', 'target', 'rel'],
      })
    : '<p class="text-muted">No content yet</p>';

  return `
    <div class="email-preview">
      <div class="email-preview-header">
        <div class="email-preview-subject">${omega.utilities().escapeHTML(subject) || '<span class="text-muted">No subject</span>'}</div>
        ${preheader ? `<div class="email-preview-preheader">${omega.utilities().escapeHTML(preheader)}</div>` : ''}
      </div>
      <div class="email-preview-body">${renderedContent}</div>
      <div class="email-preview-disclaimer text-muted small mt-3">
        <i class="fa-solid fa-triangle-exclamation fa-xs me-1"></i>
        Preview shows formatted content. Final email may vary by template.
      </div>
    </div>
  `;
}

/**
 * Render push notification preview HTML (mobile device frame).
 */
function renderPushPreview(formData) {
  const campaign = formData.campaign || {};
  const name = campaign.name || 'Notification Title';
  const subject = campaign.subject || 'Notification body text...';
  const icon = campaign.icon || '';

  const iconSrc = icon && icon.match(/^https?:\/\/.+/)
    ? omega.utilities().escapeHTML(icon)
    : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="50" height="50"%3E%3Crect width="50" height="50" fill="%236c757d" rx="8"/%3E%3C/svg%3E';

  const clickAction = campaign.clickAction || '';

  return `
    <div class="push-preview-frame">
      <div class="push-preview-screen">
        <div class="push-preview-status-bar">
          <span>9:41 AM</span>
          <span>
            <i class="fa-solid fa-wifi fa-sm me-1"></i>
            <i class="fa-solid fa-battery-full fa-sm"></i>
          </span>
        </div>
        <div class="push-preview-notification"
             ${clickAction ? `role="button" title="Click to test: ${omega.utilities().escapeHTML(clickAction)}"` : ''}
             data-click-action="${omega.utilities().escapeHTML(clickAction)}">
          <div class="d-flex align-items-start">
            <img src="${iconSrc}"
                 class="rounded me-2"
                 width="50"
                 height="50"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22%3E%3Crect width=%2250%22 height=%2250%22 fill=%22%236c757d%22 rx=%228%22/%3E%3C/svg%3E'">
            <div class="flex-fill">
              <div class="fw-semibold small">${omega.utilities().escapeHTML(name)}</div>
              <div class="small text-muted mt-1">${omega.utilities().escapeHTML(subject)}</div>
              <div class="small text-muted mt-1">
                <i class="fa-solid fa-clock fa-xs me-1"></i>
                Now
              </div>
            </div>
          </div>
        </div>
        <div class="mt-2 opacity-50">
          <div class="bg-body-secondary rounded p-2 small">
            <div class="text-muted">Earlier notifications...</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export { renderEmailPreview, renderPushPreview };
