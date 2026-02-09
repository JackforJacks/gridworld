# GridWorld Architecture

## Project Overview
- Three.js hexasphere-based world simulation (client + Node.js server)
- Webpack bundled, TypeScript throughout
- Key directories: `src/core/scene/SceneManager/` (rendering), `server/` (backend)

## Architecture Notes (Post-Rust Migration Feb 2026)
- **Simulation**: 100% Rust ECS (hecs) - people, relationships, calendar, fertility, matchmaking
- **ID allocation**: Rust `next_person_id` counter (replaced Redis idAllocator)
- **Persistence**: Bincode save files (`saves/world.bin`) - no PostgreSQL, no Redis
- **Calendar Timer**: Rust background thread controls ticking (Phase 1)
  - `rustSimulation.startCalendar(intervalMs, callback)` spawns Rust thread with sleep loop
  - `rustSimulation.stopCalendar()` stops the Rust thread
  - Rust ticks automatically, calls Node.js callback with tick results (ThreadsafeFunction)
  - Node.js CalendarService is now just an event broadcaster, no more setInterval
- **Calendar State**: Rust ECS Calendar component stores year/month/day
- **Event Log**: Rust circular buffer (10k capacity, Phase 2) - births, deaths, marriages, pregnancies, dissolutions
  - Events automatically logged by Rust `tick()` - persisted in bincode saves
  - Query via `rustSimulation.getRecentEvents()`, `getEventsByType()`, `getEventsByDateRange()`
- **Statistics**: Rust calculations from event log (Phase 3)
  - Birth/death/marriage rates per 1000 population per year calculated from event log
  - Node.js StatisticsService formats data for client, WebSocket broadcasting only
  - `rustSimulation.calculateVitalStatistics()`, `calculateCurrentYearStatistics()`, `calculateRecentStatistics()`
- **Population**: Rust `tick()` runs automatically via calendar thread; Node.js PopulationService only tracks statistics
- **Families**: Rust ECS Partner component only - no Node.js family storage (Phase 4 cleanup)
  - Node.js accesses family data via `rustSimulation.getDemographics()` (partnered, pregnant counts)
  - Legacy Redis `family` hash removed - all partnership data in Rust bincode saves
  - FamilyData interface deprecated - all family operations removed from Node.js
- **Person Queries**: Rust ECS queries via NAPI (Phase 5)
  - All person data now queried from Rust ECS, not Redis cache
  - `rustSimulation.getAllPeople()`, `getPerson(id)`, `getPeopleByTile(tileId)`
  - Returns Person with id, firstName, lastName, tileId, sex, birthDate, age, partnered/pregnant status
  - Node.js PeopleState delegates to Rust, converts to legacy PersonData format for backward compatibility
  - Write operations (updatePerson, batchRemovePersons, batchUpdateResidency) are stubs - Rust simulation systems handle state changes
  - API routes: GET /api/rust/people, GET /api/rust/people/:id, GET /api/rust/people/tile/:tileId
- **Tile Populations**: Rust ECS aggregation (Phase 6)
  - Tile population counts aggregated on-demand from Rust ECS person queries
  - `rustSimulation.getPopulationByTile()` returns array of {tileId, count}
  - No Node.js storage of tile populations - calculated dynamically from person residency
  - `loadPopulationData()` → `PopulationState.getAllTilePopulations()` → `rustSimulation.getPopulationByTile()`
  - `updateTilePopulation()` deprecated - Rust tick() updates populations via birth/death/migration systems
- **World Generation**: Rust handles initial population creation (Phase 7)
  - `rustSimulation.seedPopulationOnTileRange(min, max, tileId)` creates people with realistic demographics
  - Age distribution: 0-80 years, skewed toward young (55% ages 0-20, avg age ~25)
  - Sex ratio: 51% male, 49% female
  - Name generation: Random first/last names from curated lists (~70 male, ~70 female, ~100 surnames)
  - Newborns inherit mother's last name, get random first name appropriate for sex
  - Node.js `addPeopleToTile()` deprecated - all population creation in Rust
- **Save/Load**: 100% Rust bincode persistence (Phase 8)
  - All world state saved to `saves/world.bin` via `rustSimulation.saveToFile()`
  - Persisted data: people, partnerships, calendar, event log, next_person_id, seed
  - Atomic writes (tmp file + rename), binary format (~742KB for 1000 people with history)
  - No PostgreSQL, no Redis - single source of truth in Rust ECS
  - Node.js stateManager is thin wrapper: pauses calendar, calls Rust save/load, resumes calendar
  - Event log history preserved across restarts (10k event capacity)
- **Tiles**: Deterministic from seed (`calculateTileProperties(x,y,z,seed)`), no persistence
- SceneManager uses modular file split: `index.ts`, `geometryBuilder.ts`, `tileOverlays.ts`, `populationDisplay.ts`, `colorUtils.ts`, `lighting.ts`, `types.ts`
- Pre-existing TS errors in `server/` files and `src/index.ts` (AnyPoint vs BoundaryPoint type mismatch between TileSelector and SceneManager) - not blocking webpack build
- Webpack build command: `npx webpack --mode development`
- TypeScript check: `npx tsc --noEmit` (shows pre-existing server errors)

## Rendering Pipeline (Post-Refactor Feb 2026)
- **Indexed geometry**: Per-tile triangle fan dedup, Uint16 indices when < 65535 vertices
- **Overlay system**: Pre-built geometry for all habitable tiles, per-vertex alpha attribute toggled at runtime (zero GPU allocation)
- **Borders**: Deduplicated edges via spatial hash (canonical edge keys)
- **Materials**: MeshPhongMaterial (sphere), ShaderMaterial with alpha discard (overlays)
- **Memory**: `depthWrite: false` on overlays, `DynamicDrawUsage` on alpha attribute, mesh.userData cleared on dispose

## Key Lessons
- Three.js overlay z-fighting: offset outward from sphere origin (not tile center), use `depthWrite: false`
- Webpack HMR leaks WebGL contexts: need `module.hot.dispose()` handler calling `renderer.dispose()` + `WEBGL_lose_context`
- Population updates RAF-batched to prevent overlay rebuild storms
- `computeBoundingSphere()` must be called explicitly after building geometry from TypedArrays
