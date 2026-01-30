# TypeScript Migration Complete Guide

## Migration Status: In Progress

### Completed Steps

1. ✅ **Infrastructure Setup**
   - Installed TypeScript and all type definitions
   - Created tsconfig.json (main, server, client)
   - Updated webpack.config.js for ts-loader
   - Updated package.json scripts
   - Updated nodemon.json
   - Updated Jest configuration

2. ✅ **File Renaming**
   - All `.js` files renamed to `.ts` in:
     - `/server` (80+ files)
     - `/src` (18 files)
     - `/scripts` (52 files)

### Current Status

**TypeScript Errors**: ~500+ compilation errors across the codebase

**Main Error Categories**:
1. Environment variable types (process.env returns `string | undefined`)
2. Implicit `any` types in function parameters
3. Missing type annotations
4. Module resolution issues
5. Third-party library types

### Migration Strategy

#### Phase 1: Core Type Definitions (HIGH PRIORITY)
- [x] Create comprehensive types/global.d.ts
- [ ] Add environment.d.ts for process.env types
- [ ] Add express.d.ts for request/response extensions
- [ ] Add three.d.ts for Three.js extensions

#### Phase 2: Configuration Files (HIGH PRIORITY)
Files to fix first (most imports depend on these):
- [ ] server/config/database.ts - Fix pg Pool types
- [ ] server/config/redis.ts - Fix Redis/MockRedis types
- [ ] server/config/calendar.ts - Fix env variable types
- [ ] server/config/gameBalance.ts
- [ ] server/config/server.ts
- [ ] server/config/socket.ts

#### Phase 3: Utilities & Error Handling
- [ ] server/utils/errorHandler.ts
- [ ] server/utils/lock.ts
- [ ] server/middleware/errorHandler.ts

#### Phase 4: Services (MEDIUM PRIORITY)
- [ ] server/services/databaseService.ts
- [ ] server/services/PopulationService.ts (already has types from JSDoc)
- [ ] server/repositories/PopulationRepository.ts (already has types)
- [ ] server/services/calendarService.ts
- [ ] server/services/villageService.ts
- [ ] server/services/stateManager/*.ts
- [ ] server/services/populationState/*.ts

#### Phase 5: Routes & API
- [ ] server/routes/*.ts
- [ ] server/index.ts

#### Phase 6: Client-Side Code
- [ ] src/index.ts
- [ ] src/core/hexasphere/*.ts
- [ ] src/core/scene/*.ts
- [ ] src/managers/*.ts
- [ ] src/components/*.ts

#### Phase 7: Scripts & Tests
- [ ] scripts/*.ts
- [ ] **/__tests__/*.ts

### Common Fixes Needed

#### 1. Environment Variables
```typescript
// Before
const port = parseInt(process.env.PORT);

// After
const port = parseInt(process.env.PORT || '3000');
// Or with type assertion
const port = parseInt(process.env.PORT!);
```

#### 2. Implicit Any Parameters
```typescript
// Before
pool.on('error', (err, client) => {
  console.error(err);
});

// After
pool.on('error', (err: Error, client: any) => {
  console.error(err);
});
```

#### 3. Module Imports
```typescript
// Before
const express = require('express');

// After
import express from 'express';
// or
import * as express from 'express';
```

#### 4. Type Assertions
```typescript
// Before
const data = JSON.parse(str);

// After
const data = JSON.parse(str) as MyType;
// or
const data: MyType = JSON.parse(str);
```

### Build Commands

```bash
# Type check without emitting
npm run typecheck

# Type check with watch mode
npm run typecheck:watch

# Build server
npm run build:server

# Build client
npm run build:client

# Build everything
npm run build

# Dev mode with hot reload
npm run server:dev
npm run dev
```

### Next Actions

1. Create environment.d.ts for process.env types
2. Fix server/config/*.ts files
3. Run incremental type checking
4. Fix errors file by file
5. Ensure tests still pass
6. Update documentation

### Notes

- Use `// @ts-ignore` sparingly, only for truly problematic third-party code
- Prefer `unknown` over `any` when type is truly unknown
- Use strict null checks - helps catch bugs
- Enable all strict flags in tsconfig.json
- Consider using utility types: Partial<T>, Pick<T, K>, Omit<T, K>, etc.

### Rollback Plan

If migration needs to be reverted:
1. `git checkout -- .` to restore all files
2. `npm install` to restore dependencies
3. Remove TypeScript packages
4. Restore original jsconfig.json

### References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Migration Guide](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html)
- [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)
