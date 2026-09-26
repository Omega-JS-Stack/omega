// ============================================
// Options Component
// ============================================

// Import OMEGA Extension
import omega from '@omega.js/extension/options';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = omega;

  // Add your project-specific options logic here
  // ...

  // Log the initialization
  logger.log('Options initialized!');
});
