// Service Worker Core Library
export default function ({ options } = {}) {
  // Cache visited pages
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    console.warn('Service Worker not available or not controlled by a Service Worker.');
    return;
  }

  // Setup the service worker to cache the current page
  const currentPage = options.paths.pagePath || '/';
  const channel = new MessageChannel();

  // Listen for messages from the service worker
  channel.port1.onmessage = (event) => {
    if (event.data.status === 'success') {
      console.log('Page cached for offline use:', currentPage);
    }
  };

  // Log the caching action
  // console.log(`Caching page for offline use: ${currentPage}`);

  // Send message to service worker to cache the current page
  navigator.serviceWorker.controller.postMessage({
    command: 'update-cache',
    payload: { pages: [currentPage] }
  }, [channel.port2]);
};
