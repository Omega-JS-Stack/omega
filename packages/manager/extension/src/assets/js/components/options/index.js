// ============================================
// Options Component
// ============================================

// Import Browser Extension Manager
import Manager from '@omegajs/extension/options';

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  // Shortcuts
  const { extension, messenger, logger, webManager } = manager;

  // Add your project-specific options logic here
  // ...

  // Log the initialization
  logger.log('Options initialized!');
});
