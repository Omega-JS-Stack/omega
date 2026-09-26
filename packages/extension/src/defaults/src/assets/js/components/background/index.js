// ============================================
// Background Component (Service Worker)
// ============================================

// Import OMEGA Extension
import omega from '@omega.js/extension/background';

// Init service worker
const serviceWorker = self;

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, logger } = omega;

  // Add your project-specific background logic here
  // ...

  // Log the initialization
  logger.log('Background initialized!');
});
