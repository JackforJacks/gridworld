// DEPRECATED: use `server/utils/lock.js` (storage-aware lock) instead.
// This file remains for backwards compatibility and re-exports the newer API.

const { acquireLock, releaseLock } = require('./lock');

module.exports = {
    acquireLock,
    releaseLock
};