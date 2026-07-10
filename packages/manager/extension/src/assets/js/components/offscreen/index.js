// ============================================
// Offscreen Component - Omega Manager
// Persistent WebSocket connection to omega-manager
// ============================================

// Import Browser Extension Manager
import Manager from '@omegajs/extension/offscreen';

// Constants
const WS_URL = 'ws://localhost:9876';
const RECONNECT_INTERVAL = 5000;

// State
let ws = null;
let reconnectTimer = null;

// Create instance
const manager = new Manager();

// Initialize
manager.initialize()
.then(() => {
  const { extension, logger } = manager;

  /**
   * Connect to omega-manager WebSocket server
   */
  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        logger.log('Connected to omega-manager');
        clearReconnectTimer();
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);

          // Bookmark sync
          if (message.type === 'OMEGA_BOOKMARK_SYNC') {
            logger.log(`Received sync for ${message.brand?.name}`);
            extension.runtime.sendMessage({
              action: 'syncBrandFromOffscreen',
              data: message,
            }, (response) => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response || { success: true }));
              }
            });
            return;
          }

          // Automation commands
          if (message.type?.startsWith('OMEGA_AUTOMATE')) {
            logger.log(`Received automation: ${message.type} (${message.command || message.action || 'sequence'})`);
            extension.runtime.sendMessage({
              action: 'automateFromOffscreen',
              data: message,
            }, (response) => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response || { success: false, error: 'No response' }));
              }
            });
            return;
          }
        } catch (error) {
          logger.error('Error processing message', error);
        }
      };

      ws.onclose = () => {
        logger.log('Disconnected from omega-manager');
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws = null;
      };
    } catch {
      scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  function scheduleReconnect() {
    clearReconnectTimer();
    reconnectTimer = setTimeout(connectWebSocket, RECONNECT_INTERVAL);
  }

  /**
   * Clear the reconnection timer
   */
  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // Relay automation progress messages from background to WebSocket
  extension.runtime.onMessage.addListener((message) => {
    if (message.action === 'automateProgress' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message.data));
    }
  });

  // Start connection
  connectWebSocket();

  logger.log('Offscreen initialized!');
});
