# Service Coupling Refactoring

## Overview
Refactored `PopulationService` to reduce coupling and improve testability using:
- **Repository Pattern** for data access
- **Event Emitters** for service communication
- **Socket Service** for decoupled socket.io communication

## Architecture Changes

### Before
```
PopulationService
├── Direct DB queries (pool.query everywhere)
├── Direct socket.io calls (this.io.emit)
├── Direct calendar service coupling
└── Mixed concerns (data access + business logic + communication)
```

### After
```
PopulationService
├── PopulationRepository (data access layer)
├── PopulationEventEmitter (event-driven communication)
├── SocketService (socket.io abstraction)
└── Clean separation of concerns
```

## New Components

### 1. PopulationRepository (`server/repositories/PopulationRepository.js`)
Encapsulates all database access logic:

```javascript
const PopulationRepository = require('./repositories/PopulationRepository');
const repo = new PopulationRepository(pool);

// Clean data access methods
const people = await repo.getAllPeople({ tileId: 1 });
const person = await repo.getPersonById(123);
const families = await repo.getAllFamilies({ tileId: 1 });
const demographics = await repo.getDemographics();

// Transaction support
await repo.transaction(async (client) => {
    await client.query('INSERT INTO people...');
    await client.query('UPDATE family...');
});
```

### 2. PopulationEventEmitter (`server/events/populationEvents.js`)
Decouples services through events:

```javascript
const populationEvents = require('./events/populationEvents');

// Emit events
populationEvents.emitBirth({ personId, tileId, date });
populationEvents.emitDeath({ personId, tileId, cause });
populationEvents.emitFamilyCreated({ familyId, husbandId, wifeId });

// Listen to events
populationEvents.onBirth((data) => {
    console.log('Birth occurred:', data);
});

populationEvents.onDeath((data) => {
    console.log('Death occurred:', data);
});
```

### 3. SocketService (`server/services/SocketService.js`)
Abstracts socket.io communication:

```javascript
const SocketService = require('./services/SocketService');
const socketService = new SocketService(io);

// Clean socket emissions
socketService.emitPopulationUpdate(data);
socketService.emitBirth(birthData);
socketService.emitGameSaved(saveData);

// No direct io dependency needed
```

## Benefits

### 1. **Improved Testability**
```javascript
// Mock repository for testing
const mockRepo = {
    getAllPeople: jest.fn().mockResolvedValue([...]),
    getPersonById: jest.fn().mockResolvedValue({...})
};

const service = new PopulationService(io, calendar);
service.repository = mockRepo; // Easy to inject mocks
```

### 2. **Single Responsibility Principle**
- `PopulationService`: Business logic only
- `PopulationRepository`: Data access only
- `SocketService`: Communication only
- `PopulationEventEmitter`: Event coordination only

### 3. **Decoupled Communication**
```javascript
// Service A emits event
populationEvents.emitBirth({ personId: 123 });

// Service B listens independently
populationEvents.onBirth((data) => {
    statisticsService.recordBirth(data);
});

// Service C also listens
populationEvents.onBirth((data) => {
    socketService.emitBirth(data);
});
```

### 4. **Easier Maintenance**
- Change database? Update repository only
- Change socket library? Update SocketService only
- Add event listener? No changes to emitting service

### 5. **Better Error Handling**
```javascript
// Repository throws typed errors
try {
    await repo.getPersonById(123);
} catch (error) {
    if (error instanceof DatabaseError) {
        // Handle DB error specifically
    }
}
```

## Migration Guide

### Old Pattern
```javascript
// Direct DB query
const result = await pool.query('SELECT * FROM people WHERE tile_id = $1', [tileId]);
const people = result.rows;

// Direct socket emission
this.io.emit('populationUpdate', data);
```

### New Pattern
```javascript
// Use repository
const people = await this.repository.getPeopleByTile(tileId);

// Use event emitter
this.events.emitPopulationUpdated({ tileId, population: people.length });
```

## Testing Examples

### Test PopulationService in Isolation
```javascript
const mockRepository = {
    getAllPeople: jest.fn().mockResolvedValue([]),
    getTilePopulations: jest.fn().mockResolvedValue([])
};

const mockSocketService = {
    emitPopulationUpdate: jest.fn()
};

const service = new PopulationService(null, null);
service.repository = mockRepository;
service.socketService = mockSocketService;

// Test without real DB or sockets
await service.getPopulations();
expect(mockRepository.getAllPeople).toHaveBeenCalled();
```

### Test Event Flow
```javascript
const populationEvents = require('./events/populationEvents');

const birthHandler = jest.fn();
populationEvents.onBirth(birthHandler);

populationEvents.emitBirth({ personId: 123 });
expect(birthHandler).toHaveBeenCalledWith(expect.objectContaining({
    personId: 123
}));
```

## Performance Impact
- **Minimal overhead**: Event emitters are very lightweight
- **Better caching**: Repository can implement caching strategies
- **Reduced coupling**: Services can be optimized independently

## Future Improvements
1. Add repository caching layer
2. Implement query builder for complex queries
3. Add event middleware for cross-cutting concerns
4. Create repository interfaces for different data sources
