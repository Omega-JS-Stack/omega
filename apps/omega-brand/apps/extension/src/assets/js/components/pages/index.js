// ============================================
// Index Page (Main Extension Page)
// ============================================

// Import OMEGA Extension
import Manager from '@omega.js/extension/page';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, omega } = manager;

  // Add your project-specific page logic here
  // ...

  // Log the initialization
  logger.log('Index page initialized!');
});
