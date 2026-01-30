/**
 * State Manager - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - stateManager/loadOperations.js - Loading state from PostgreSQL to Redis
 * - stateManager/saveOperations.js - Saving Redis state to PostgreSQL  
 * - stateManager/redisOperations.js - Redis CRUD operations
 * - stateManager/index.js - Main StateManager class
 * 
 * This file re-exports the unified StateManager class for backwards compatibility.
 */

export { default } from './stateManager/index';
