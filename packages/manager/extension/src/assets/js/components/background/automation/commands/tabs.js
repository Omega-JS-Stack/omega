/**
 * Tabs Command
 *
 * Lists and queries open browser tabs.
 */

/**
 * @param {number} tabId — unused (tabs command is tab-independent)
 * @param {{ url?, title?, active?, currentWindow? }} params
 */
export default async function tabs(tabId, params) {
  const query = {};

  if (params.url) {
    query.url = params.url;
  }
  if (params.title) {
    query.title = params.title;
  }
  if (params.active !== undefined) {
    query.active = params.active;
  }
  if (params.currentWindow !== undefined) {
    query.currentWindow = params.currentWindow;
  }

  const results = await chrome.tabs.query(query);

  return {
    tabs: results.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
      index: tab.index,
    })),
    count: results.length,
  };
}
