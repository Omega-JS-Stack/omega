// ============================================
// Background Component (Service Worker)
// ============================================

// Import OMEGA Extension
import Manager from '@omega.js/extension/background';

// Create instance
const manager = new Manager();

// Init service worker
const serviceWorker = self;

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, logger, omega } = manager;

  // Add your project-specific background logic here
  // ...

  // Log the initialization
  logger.log('Background initialized!');
});
