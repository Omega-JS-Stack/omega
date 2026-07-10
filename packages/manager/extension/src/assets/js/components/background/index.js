// ============================================
// Background Component (Service Worker)
// ============================================

// Import Browser Extension Manager
import Manager from '@omega.js/extension/background';

// Import automation runner
import { handleAutomation } from './automation/runner.js';

// Constants
const ROOT_FOLDER_NAME = '\u03A9';
const OFFSCREEN_DOCUMENT_PATH = 'views/offscreen/index.html';

// State
let creatingOffscreen = null;

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  const { extension, logger } = manager;

  // =============================================================================
  // OFFSCREEN DOCUMENT MANAGEMENT
  // =============================================================================

  async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    return contexts.length > 0;
  }

  async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) {
      return;
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['WEB_RTC'],
      justification: 'Maintain WebSocket connection to omega-manager for bookmark sync',
    });

    await creatingOffscreen;
    creatingOffscreen = null;
    logger.log('Offscreen document created');
  }

  // =============================================================================
  // BOOKMARK MANAGEMENT
  // =============================================================================

  async function getOmegaFolder() {
    const results = await chrome.bookmarks.search({ title: ROOT_FOLDER_NAME });
    const existing = results.find(
      (b) => b.title === ROOT_FOLDER_NAME && b.parentId === '1',
    );

    if (existing) {
      return existing;
    }

    return chrome.bookmarks.create({
      parentId: '1',
      title: ROOT_FOLDER_NAME,
    });
  }

  async function sortChildrenAlphabetically(parentId) {
    const children = await chrome.bookmarks.getChildren(parentId);
    const sorted = [...children].sort((a, b) => a.title.localeCompare(b.title));

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].index !== i) {
        await chrome.bookmarks.move(sorted[i].id, { parentId, index: i });
      }
    }
  }

  async function deleteBrandFolder(omegaFolderId, brandName) {
    const children = await chrome.bookmarks.getChildren(omegaFolderId);
    const existing = children.find((b) => b.title === brandName && !b.url);

    if (existing) {
      await chrome.bookmarks.removeTree(existing.id);
    }
  }

  async function syncBrandBookmarks(message) {
    const { brand, links } = message;
    const name = brand?.name;

    if (!name || !links) {
      return { success: false, error: 'Missing name or links' };
    }

    const results = { brand: name, created: 0 };

    try {
      const omegaFolder = await getOmegaFolder();

      // Delete existing brand folder for clean slate
      await deleteBrandFolder(omegaFolder.id, name);

      // Create fresh brand folder
      const brandFolder = await chrome.bookmarks.create({
        parentId: omegaFolder.id,
        title: name,
      });

      // Add all categories and bookmarks
      for (const [category, bookmarks] of Object.entries(links)) {
        const categoryFolder = await chrome.bookmarks.create({
          parentId: brandFolder.id,
          title: category,
        });

        for (const bookmark of bookmarks) {
          await chrome.bookmarks.create({
            parentId: categoryFolder.id,
            title: bookmark.title,
            url: bookmark.url,
          });
          results.created++;
        }
      }

      // Sort categories within brand alphabetically
      await sortChildrenAlphabetically(brandFolder.id);

      // Sort brands within Omega alphabetically
      await sortChildrenAlphabetically(omegaFolder.id);

      return { success: true, ...results };
    } catch (error) {
      return { success: false, error: error.message, ...results };
    }
  }

  async function sortAllOmegaBookmarks() {
    try {
      const omegaFolder = await getOmegaFolder();
      const brands = await chrome.bookmarks.getChildren(omegaFolder.id);

      // Sort categories within each brand
      for (const brand of brands) {
        if (brand.url) continue;
        await sortChildrenAlphabetically(brand.id);
      }

      // Sort brands within Omega
      await sortChildrenAlphabetically(omegaFolder.id);

      logger.log('Bookmarks sorted');
      return { success: true };
    } catch (error) {
      logger.log('Sort failed -', error.message);
      return { success: false, error: error.message };
    }
  }

  async function getAllOmegaBookmarks() {
    try {
      const omegaFolder = await getOmegaFolder();
      const brands = await chrome.bookmarks.getChildren(omegaFolder.id);

      const result = {};

      for (const brand of brands) {
        if (brand.url) continue;

        result[brand.title] = {};
        const categories = await chrome.bookmarks.getChildren(brand.id);

        for (const category of categories) {
          if (category.url) continue;

          const bookmarks = await chrome.bookmarks.getChildren(category.id);
          result[brand.title][category.title] = bookmarks
            .filter((b) => b.url)
            .map((b) => ({ title: b.title, url: b.url }));
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  // =============================================================================
  // MESSAGE HANDLERS
  // =============================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Sync request from offscreen document
    if (message.action === 'syncBrandFromOffscreen') {
      syncBrandBookmarks(message.data).then(sendResponse);
      return true;
    }

    // Get bookmarks for popup
    if (message.action === 'getBookmarks') {
      getAllOmegaBookmarks().then(sendResponse);
      return true;
    }

    // Get offscreen document status
    if (message.action === 'getStatus') {
      hasOffscreenDocument().then((exists) => {
        sendResponse({ connected: exists });
      });
      return true;
    }

    // Sort all bookmarks
    if (message.action === 'sortBookmarks') {
      sortAllOmegaBookmarks().then(sendResponse);
      return true;
    }

    // Automation commands from offscreen document
    if (message.action === 'automateFromOffscreen') {
      handleAutomation(message.data).then(sendResponse);
      return true;
    }
  });

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  // Create offscreen document on startup
  setupOffscreenDocument();

  // Sort bookmarks on startup
  sortAllOmegaBookmarks();

  // Recreate offscreen document and re-sort when service worker wakes up
  chrome.runtime.onStartup.addListener(() => {
    setupOffscreenDocument();
    sortAllOmegaBookmarks();
  });

  logger.log('Background initialized!');
});
