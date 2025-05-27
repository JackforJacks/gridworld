// Expose THREE and Hexasphere globally
window.THREE = require('three');
const Hexasphere = require('../src/hexaSphere');
window.Hexasphere = Hexasphere;

// If using ECSY
window.ECSY = require('ecsy');

// For CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Hexasphere;
}

// For ES modules
if (typeof exports !== 'undefined') {
    exports.default = Hexasphere;
}
