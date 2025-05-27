/**
 * hexaSphereGlobal.js
 * This file exposes THREE and Hexasphere globally and handles module exports
 * The bundling is handled by Grunt/Browserify
 */

// Import dependencies
window.THREE = require('three');
const Hexasphere = require('../src/hexaSphere');

// Expose Hexasphere globally for browser access
window.Hexasphere = Hexasphere;

// Export for CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Hexasphere;
}

// Export for ES modules
if (typeof exports !== 'undefined') {
    exports.default = Hexasphere;
}
