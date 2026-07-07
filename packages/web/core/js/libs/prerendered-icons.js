/**
 * Prerendered Icons Library
 * Retrieves pre-rendered icon HTML from the frontmatter icon system
 */
import webManager from 'web-manager';

/**
 * Get pre-rendered icon by name from frontmatter icon system.
 * Drop-in replacement for uj_icon in JavaScript contexts.
 *
 * @param {string} iconName - Name of the icon to retrieve (matches data-icon attribute)
 * @param {string} [classes] - CSS classes for the <i> wrapper (e.g. "fa-md me-2"), like uj_icon's second argument.
 * @returns {string} Icon HTML or empty string if not found
 *
 * @example
 * import { getPrerenderedIcon } from '__main_assets__/js/libs/prerendered-icons.js';
 *
 * // No size class
 * getPrerenderedIcon('apple');
 *
 * // With size + classes (same as {% uj_icon "robot", "fa-md me-2" %})
 * getPrerenderedIcon('robot', 'fa-md me-2');
 */
export function getPrerenderedIcon(iconName, classes) {
  const $iconTemplate = document.querySelector(`#prerendered-icons [data-icon="${iconName}"]`);

  if (!$iconTemplate) {
    return '';
  }

  if (!classes) {
    return $iconTemplate.innerHTML;
  }

  return $iconTemplate.innerHTML.replace('class="fa"', `class="fa ${webManager.utilities().escapeHTML(classes)}"`);
}