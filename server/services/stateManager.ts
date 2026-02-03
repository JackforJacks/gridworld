/**
 * State Manager - Backwards-compatible re-export
 * 
 * The implementation has been refactored into modular files:
 * - stateManager/loadOperations.ts - Loading state from PostgreSQL to Redis
 * - stateManager/saveOperations.ts - Saving Redis state to PostgreSQL  
 * - stateManager/redisOperations.ts - Redis CRUD operations
 * - stateManager/index.ts - Main StateManager class
 * 
 * This file re-exports the unified StateManager class for backwards compatibility.
 */

export { default } from './stateManager/index';
