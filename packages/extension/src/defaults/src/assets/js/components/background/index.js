// ============================================
// Background Component (Service Worker)
// ============================================

// Import OMEGA Extension
import Manager from '@omegajs/extension/background';

// Create instance
const manager = new Manager();

// Init service worker
const serviceWorker = self;

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, logger, webManager } = manager;

  // Add your project-specific background logic here
  // ...

  // Log the initialization
  logger.log('Background initialized!');
});
