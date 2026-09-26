// ============================================
// Content Script Component
// ============================================

// Import OMEGA Extension
import omega from '@omega.js/extension/content';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = omega;

  // Add your project-specific content script logic here
  // ...

  // Log the initialization
  logger.log('Content script initialized!');
});
