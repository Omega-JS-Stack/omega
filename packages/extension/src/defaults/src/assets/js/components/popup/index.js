// ============================================
// Popup Component
// ============================================

// Import OMEGA Extension
import omega from '@omega.js/extension/popup';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = omega;

  // Add your project-specific popup logic here
  // ...

  // Log the initialization
  logger.log('Popup initialized!');
});
