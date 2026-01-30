# TypeScript Migration Guide

## Overview
Gradual TypeScript migration using JSDoc and `@ts-check` directive.

## What Was Done

### 1. Project Configuration
- **jsconfig.json**: Enables TypeScript checking for JavaScript files
  - `checkJs: true` - Type-check all JS files
  - `strict: true` - Enable strict type checking
  - Path mappings for clean imports

### 2. Type Definitions
- **types/global.d.ts**: Centralized type definitions
  - Common interfaces: `TileData`, `PersonData`, `FamilyData`, `VillageData`
  - Helper types: `RotationState`, `PopulationStats`, `CalendarDate`
  - Window global extensions

### 3. Files with Type Checking

#### ✅ src/core/scene/scene.js
- Added `@ts-check` directive
- JSDoc for all functions: `createScene`, `tick`, `onWindowResize`
- Type imports from global.d.ts

#### ✅ src/core/hexasphere/Tile.js
- Added `@ts-check` directive
- JSDoc for all functions and constructor
- Local typedef for `Vector3D`

#### ✅ server/services/PopulationService.js
- Added `@ts-check` directive
- JSDoc for class and constructor
- Type imports for domain types

#### ✅ server/repositories/PopulationRepository.js
- Added `@ts-check` directive
- Detailed JSDoc for repository methods
- Return types and parameter documentation

## How to Use

### Enable Type Checking in a File
```javascript
// @ts-check

/**
 * @param {number} id - User ID
 * @param {string} name - User name
 * @returns {Promise<User>} User object
 */
async function getUser(id, name) {
    // TypeScript will check this!
}
```

### Import Types
```javascript
// @ts-check

/**
 * @typedef {import('../types/global').TileData} TileData
 * @typedef {import('../types/global').PersonData} PersonData
 */

/**
 * @param {TileData} tile
 * @param {PersonData[]} people
 */
function processTile(tile, people) {
    // ...
}
```

### Define Complex Types
```javascript
/**
 * @typedef {Object} Config
 * @property {string} name - Configuration name
 * @property {number} value - Configuration value
 * @property {boolean} [optional] - Optional flag
 */

/**
 * @param {Config} config
 */
function configure(config) {
    // ...
}
```

## Migration Strategy

### Phase 1: Core Infrastructure (✅ DONE)
- [x] Create jsconfig.json
- [x] Create global type definitions
- [x] Add types to scene rendering
- [x] Add types to hexasphere/Tile
- [x] Add types to PopulationService
- [x] Add types to PopulationRepository

### Phase 2: Services (TODO)
- [ ] Add types to CalendarService
- [ ] Add types to VillageService
- [ ] Add types to StatisticsService
- [ ] Add types to SocketService
- [ ] Add types to StateManager

### Phase 3: Utilities & Helpers (TODO)
- [ ] Add types to error handlers
- [ ] Add types to validators
- [ ] Add types to formatters
- [ ] Add types to math utilities

### Phase 4: API Routes (TODO)
- [ ] Add types to Express routes
- [ ] Add types to API handlers
- [ ] Add types to middleware

### Phase 5: Client-side (TODO)
- [ ] Add types to UI components
- [ ] Add types to event handlers
- [ ] Add types to data managers

## Benefits Already Gained

✅ **Compile-time Error Detection**
```javascript
// This will show an error now:
function process(tile) {
    tile.invalidProperty; // Error: Property doesn't exist
}
```

✅ **Better IDE Autocomplete**
- IntelliSense shows available properties
- Parameter hints display inline
- Return types are inferred

✅ **Safer Refactoring**
- Rename symbols across files
- Find all references with confidence
- Detect breaking changes immediately

✅ **Documentation**
- JSDoc serves as inline documentation
- Types document expected data shapes
- Reduces need for separate docs

## Common Patterns

### Function with Options Object
```javascript
/**
 * @typedef {Object} SaveOptions
 * @property {boolean} [validate=true] - Validate before saving
 * @property {boolean} [broadcast=false] - Broadcast to clients
 */

/**
 * @param {PersonData[]} people
 * @param {SaveOptions} [options={}]
 * @returns {Promise<void>}
 */
async function savePeople(people, options = {}) {
    // ...
}
```

### Async Functions
```javascript
/**
 * @param {number} id
 * @returns {Promise<PersonData | null>}
 */
async function findPerson(id) {
    // Returns PersonData or null
}
```

### Callbacks
```javascript
/**
 * @callback OnComplete
 * @param {Error | null} error
 * @param {PersonData} result
 * @returns {void}
 */

/**
 * @param {number} id
 * @param {OnComplete} callback
 */
function loadPerson(id, callback) {
    // ...
}
```

## Troubleshooting

### Disable Checking for a Line
```javascript
// @ts-ignore
const x = legacyFunction(); // Skip this line
```

### Disable Checking for a File
```javascript
// @ts-nocheck
// Entire file won't be checked
```

### Type Assertions
```javascript
/** @type {PersonData} */
const person = unknownValue;
```

### Any Type (Use Sparingly)
```javascript
/**
 * @param {any} data - Accept any type
 */
function process(data) {
    // ...
}
```

## Next Steps

1. **Add types to remaining services** - Follow the pattern in PopulationService
2. **Create more .d.ts files** - Group related types together
3. **Enable stricter checks** - Gradually increase strictness in jsconfig.json
4. **Eventually migrate to .ts** - When ready, rename .js to .ts files

## Resources

- [JSDoc Reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [VS Code TypeScript](https://code.visualstudio.com/docs/languages/typescript)
