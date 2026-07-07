/**
 * Admin Marketing Calendar Page JavaScript
 */

// Libraries
import CalendarCore from './calendar-core.js';
import CalendarRenderer from './calendar-renderer.js';
import CalendarEvents from './calendar-events.js';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    webManager.auth().listen({ once: true }, async (state) => {
      if (!state.user) {
        return;
      }

      initialize();
    });

    // Resolve after initialization
    return resolve();
  });
};

// Initialize the calendar
function initialize() {
  const core = new CalendarCore();
  const renderer = new CalendarRenderer(core);
  const events = new CalendarEvents(core);

  core.setRenderer(renderer);
  core.setEventsManager(events);
  core.initialize();
}

