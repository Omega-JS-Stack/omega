// ============================================
// Index Page (Main Extension Page)
// ============================================

// Import OMEGA Extension
import omega from '@omega.js/extension/page';

// Initialize
omega.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger } = omega;

  // Add your project-specific page logic here
  // ...

  // Log the initialization
  logger.log('Index page initialized!');
});
