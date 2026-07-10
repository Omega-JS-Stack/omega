// // Libraries
// const WebManager = require('@omega.js/client');

// // Class
// function Manager() {
//   const self = this;

//   // Properties
//   self.extension = null;
//   self.messenger = null;
//   self.logger = null;
//   self.omega = null;

//   // Return
//   return self;
// }

// Manager.prototype.initialize = function (callback) {
//   const self = this;

//   // Configuration
//   const configuration = window.OMEGA_BUILD_JSON?.config;

//   // Initiate the web manager
//   self.extension = require('./lib/extension');
//   self.messenger = null;
//   self.logger = new (require('./lib/logger-lite'))('popup');
//   self.omega = new WebManager();

//   // Initialize
//   self.omega.init(configuration, callback);

//   // Return
//   return self.omega;
// };

// Manager.prototype.library = function (name) {
//   const self = this;

//   // Return
//   return require(`./lib/${name}`);
// };


// // Export
// module.exports = Manager;
