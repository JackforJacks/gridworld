# GridWorld Architecture

## Project Overview
- Three.js hexasphere-based world simulation (Tauri desktop app)
- Webpack bundled, TypeScript throughout
- Key directories: `src/core/scene/SceneManager/` (rendering), `src-tauri/` (Rust backend)

## Architecture Notes (Post-Rust Migration Feb 2026)
- **Simulation**: 100% Rust ECS (hecs) - people, relationships, calendar, fertility, matchmaking
- **ID allocation**: Rust `next_person_id` counter (replaced Redis idAllocator)
- **Persistence**: Bincode save files (`saves/world.bin`) - no PostgreSQL, no Redis
- **Calendar Timer**: Rust background thread controls ticking
  - Tauri command `start_calendar(speed)` spawns Rust thread with sleep loop
  - Tauri command `stop_calendar()` stops the Rust thread
  - Rust ticks automatically, emits `calendar-tick` Tauri events with tick results
  - Client listens via `@tauri-apps/api/event` for real-time updates
- **Calendar State**: Rust ECS Calendar component stores year/month/day
- **Event Log**: Rust circular buffer (10k capacity) - births, deaths, marriages, pregnancies, dissolutions
  - Events automatically logged by Rust `tick()` - persisted in bincode saves
  - Query via Tauri commands: `get_recent_events()`, `get_event_count()`
- **Statistics**: Rust calculations from event log
  - Birth/death/marriage rates per 1000 population per year calculated from event log
  - Tauri commands: `get_vital_statistics(startYear, endYear)`, `get_current_year_statistics()`, `get_recent_statistics(years?)`
  - Client queries on-demand via Tauri IPC
- **Population**: Rust `tick()` runs automatically via calendar thread; client tracks statistics from `calendar-tick` events
- **Families**: Rust ECS Partner component only
  - Client accesses family data via Tauri command `get_demographics()` (partnered, pregnant counts)
  - All partnership data stored in Rust ECS, persisted in bincode saves
- **Person Queries**: Rust ECS queries via Tauri commands
  - All person data queried from Rust ECS
  - Tauri commands: `get_all_people()`, `get_person(id)`, `get_people_by_tile(tileId)`
  - Returns Person with id, firstName, lastName, tileId, sex, birthDate, age, partnered/pregnant status
  - All state changes handled by Rust simulation systems during tick
- **Tile Populations**: Rust ECS aggregation
  - Tile population counts aggregated on-demand from Rust ECS person queries
  - Tauri command `get_population_by_tile()` returns array of {tileId, count}
  - No caching - calculated dynamically from person residency
  - Populations update automatically via Rust tick() systems (birth/death/migration)
- **World Generation**: Rust handles initial population creation
  - Tauri command `restart_world(habitableTileIds, seed)` creates people with realistic demographics
  - Age distribution: 0-80 years, skewed toward young (55% ages 0-20, avg age ~25)
  - Sex ratio: 51% male, 49% female
  - Name generation: Random first/last names from curated lists (~70 male, ~70 female, ~100 surnames)
  - Newborns inherit mother's last name, get random first name appropriate for sex
- **Save/Load**: 100% Rust bincode persistence
  - All world state saved to `saves/world.bin` via Tauri command `save_world(filePath)`
  - Persisted data: people, partnerships, calendar, event log, next_person_id, seed
  - Atomic writes (tmp file + rename), binary format (~742KB for 1000 people with history)
  - Single source of truth in Rust ECS - no external databases
  - Tauri commands pause calendar, save/load, resume calendar automatically
  - Event log history preserved across restarts (10k event capacity)
- **Tiles**: Deterministic from seed (Tauri command `calculate_tile_properties(tiles)`), no persistence
- SceneManager uses modular file split: `index.ts`, `geometryBuilder.ts`, `tileOverlays.ts`, `populationDisplay.ts`, `colorUtils.ts`, `lighting.ts`, `types.ts`
- Build commands:
  - Webpack: `npm run build` (frontend bundle)
  - Tauri dev: `npm run tauri dev` (development with HMR)
  - Tauri build: `npm run tauri build` (production desktop app)

## Tauri IPC Architecture

- **Frontend-Backend Communication**: Pure Tauri IPC (no HTTP, no WebSocket)
  - Client uses `@tauri-apps/api/core` for command invocations
  - Client uses `@tauri-apps/api/event` for real-time updates
  - `ApiClient.ts` singleton wraps all Tauri `invoke()` calls

- **Tauri Commands**: 28 commands across 8 modules
  - **Calendar**: `get_calendar_state`, `start_calendar`, `stop_calendar`, `set_calendar_speed`, `get_calendar_speeds`
  - **World**: `tick`, `save_world`, `load_world`, `restart_world`
  - **Population**: `get_population`, `get_demographics`, `get_population_by_tile`, `get_tile_population`
  - **People**: `get_all_people`, `get_person`, `get_people_by_tile`
  - **Statistics**: `get_vital_statistics`, `get_current_year_statistics`, `get_recent_statistics`, `get_recent_events`, `get_event_count`
  - **Tiles**: `calculate_tile_properties`
  - **Config**: `get_config`
  - **Memory**: `get_memory_usage`, `exit_app`

- **Tauri Events**: Real-time updates via event emission
  - `calendar-tick`: Emitted by Rust calendar thread on each tick
  - Payload: `{ births, deaths, marriages, pregnancies, dissolutions, population, year, month, day }`
  - Listeners: `CalendarManager`, `PopulationManager` (client-side)

- **State Management**:
  - Rust: `AppState` holds `Arc<Mutex<SimulationWorld>>`, `CalendarRunner`, `seed`
  - All Tauri commands access shared state via Tauri's state management
  - Thread-safe access to ECS world via Mutex locks

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
