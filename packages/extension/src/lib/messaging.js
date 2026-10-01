// Libraries
// import ext from './ext';
const ext = require('./extension.js');
const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('messaging');

// The destination that addresses every context at once: background's auth
// broadcasts (a sign-in token, a sign-out) reach every open page without
// naming each one.
const BROADCAST = '*';

// Messaging: the ONE lane between contexts. Every context (background included)
// builds one with its own name as `sender`; `send()` addresses a context by
// name (or BROADCAST), and `onMessage(handler)` registers a handler for the
// messages addressed to this context.
function Messaging(init) {
  const self = this;

  // Check init
  if (!init || !init.sender) {
    throw new Error('No init and/or init.sender')
  }

  // Setup
  self.sender = init.sender;
  self._handlers = [];
  self._hold = null;
  ext.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
      return self._dispatch(request, sender, sendResponse);
    }
  );
}

// Register a handler. It receives (message, sender, sendResponse) and returns
// true to answer asynchronously through sendResponse, the runtime's own
// contract. Returns the unsubscribe.
Messaging.prototype.onMessage = function (handler) {
  const self = this;

  self._handlers.push(handler);

  return function () {
    const index = self._handlers.indexOf(handler);
    if (index > -1) {
      self._handlers.splice(index, 1);
    }
  };
};

// Hold dispatch until `promise` settles: a message that arrives first waits,
// then reaches the handlers, so it reads the state the promise was restoring.
// A held message no handler claims is answered with nothing. A rejected
// promise releases too: the held messages read whatever state it left.
Messaging.prototype.holdUntil = function (promise) {
  const self = this;

  const hold = promise
    .catch(function (e) {
      logger.error('Hold rejected, releasing the held messages:', e);
    })
    .then(function () {
      if (self._hold === hold) {
        self._hold = null;
      }
    });

  self._hold = hold;
};

// Hand one runtime message to every handler, unless it is addressed to another
// context: the runtime delivers a page's message to background AND to every
// other open page, and only the named one is its receiver. A message with no
// destination (a raw runtime.sendMessage) reaches every handler, as it always did.
Messaging.prototype._dispatch = function (request, sender, sendResponse) {
  const self = this;
  const destination = request && request.destination;

  if (destination && destination !== BROADCAST && destination !== self.sender) {
    return false;
  }

  // true keeps the channel open until the hold settles, so a held message is
  // always answered, even when a handler throws on it
  if (self._hold) {
    self._hold.then(function () {
      try {
        if (!self._deliver(request, sender, sendResponse)) {
          sendResponse();
        }
      } catch (e) {
        logger.error(`Handler threw on held message ${request.command}:`, e);
        sendResponse();
      }
    });
    return true;
  }

  return self._deliver(request, sender, sendResponse);
};

// Call every handler; true when one of them answers asynchronously
Messaging.prototype._deliver = function (request, sender, sendResponse) {
  const self = this;

  // Iterate a copy: a handler may unsubscribe while it is being called
  let keepOpen = false;
  self._handlers.slice().forEach(function (handler) {
    if (handler(request, sender, sendResponse) === true) {
      keepOpen = true;
    }
  });

  return keepOpen;
};

// Send: resolves with the receiver's response, or undefined when nobody answered
Messaging.prototype.send = function (request) {
  const self = this;

  // Check request
  if (!request) {
    throw new Error('No request')
  } else if (!request.destination) {
    throw new Error('No request.destination')
  }

  // Check sender
  return ext.runtime.sendMessage({
    sender: self.sender,
    destination: request.destination,
    command: request.command,
    payload: request.payload,
  })
  .catch(e => {
    console.warn(`Failed to send message ${self.sender} => ${request.destination}`, request.command, request.payload);
  })
};

Messaging.BROADCAST = BROADCAST;

// Export
module.exports = Messaging;
