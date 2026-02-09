# GridWorld

An Open Source Tauri v2 desktop application featuring an interactive 3D hexasphere world simulation with real-time population dynamics, built with Three.js and a Rust ECS simulation engine.

![GridWorld Demo](demo.png)

## Prerequisites

- **Node.js** >= 18.0.0 (build tools only - not needed at runtime)
- **Rust** >= 1.70 (install via [rustup.rs](https://rustup.rs/))
- **Tauri v2 system dependencies** (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
  - Windows: Microsoft Visual Studio C++ Build Tools, WebView2
  - Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
  - macOS: Xcode Command Line Tools

**No servers, no databases** - GridWorld is a self-contained desktop application.

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-repo/gridworld.git
cd gridworld
npm install
```

### 2. Run in Development Mode

```bash
npm run tauri dev
```

This builds the Rust backend, starts the webpack dev server on `http://localhost:8080`, and opens the Tauri window. Hot reload is enabled for frontend changes.

### 3. Build for Distribution

```bash
npm run tauri build
```

Produces a platform-specific installer in `src-tauri/target/release/bundle/`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Start the full Tauri app in development mode |
| `npm run tauri build` | Build distributable binary for current platform |
| `npm run dev` | Start webpack dev server only (frontend) |
| `npm run build` | Build frontend with webpack (production) |
| `npm run build:dev` | Build frontend (development, no minification) |
| `npm run clean` | Remove `dist/` folder |
| `npm run typecheck` | Run TypeScript type checking |

## Project Structure

```
GridWorld/
├── src/                        # Frontend (TypeScript + Three.js)
│   ├── index.ts                # Application entry point
│   ├── core/
│   │   ├── hexasphere/         # Hexasphere geometry generation
│   │   ├── scene/              # SceneManager (rendering, overlays, lighting)
│   │   └── renderer/           # Background stars, WebGL setup
│   ├── components/
│   │   ├── controls/           # TileSelector, InputHandler, CameraController
│   │   └── dashboard/          # CalendarDisplay, HeapMeter, StatisticsManager
│   ├── managers/
│   │   ├── calendar/           # CalendarManager (Tauri IPC)
│   │   ├── population/         # PopulationManager (Tauri event listener)
│   │   └── ui/                 # UIManager (dashboard, menus, panels)
│   └── services/api/           # ApiClient (Tauri invoke wrapper)
│
├── src-tauri/                  # Tauri desktop shell (Rust)
│   ├── src/
│   │   ├── main.rs             # App entry, command registration
│   │   ├── state.rs            # AppState, serializable types
│   │   └── commands/           # IPC command handlers
│   │       ├── calendar.rs     # Start/stop/speed controls
│   │       ├── world.rs        # Save, load, restart
│   │       ├── population.rs   # Population queries
│   │       ├── people.rs       # Individual person queries
│   │       ├── statistics.rs   # Vital rates, event log
│   │       ├── tiles.rs        # Tile property calculation
│   │       └── config.rs       # Hexasphere configuration
│   └── tauri.conf.json         # Tauri app configuration
│
├── simulation/                 # Rust ECS simulation engine (library crate)
│   └── src/
│       ├── lib.rs              # Public API exports
│       ├── world.rs            # SimulationWorld (hecs ECS orchestrator)
│       ├── components.rs       # ECS components (Person, Partner, Calendar)
│       ├── systems/            # Simulation systems (death, birth, matchmaking)
│       ├── persistence.rs      # Bincode save/load
│       ├── calendar_runner.rs  # Background tick thread
│       └── names.rs            # Name generation
│
├── css/                        # Stylesheets
├── types/                      # TypeScript type definitions
├── saves/                      # World save files (binary, gitignored)
├── webpack.config.js           # Webpack bundler configuration
├── tsconfig.json               # TypeScript configuration
├── Cargo.toml                  # Rust workspace definition
└── package.json                # Node.js dependencies and scripts
```

## Features

- **🎮 Interactive 3D Globe** - Explore a hexasphere world with smooth camera controls
- **👥 Population Simulation** - Realistic demographics with aging, birth, death, and marriage systems
- **⚡ High Performance** - Rust ECS simulation engine with 100% native performance
- **💾 Portable Saves** - Binary save files (~742KB for 1000+ people with full event history)
- **📊 Real-time Statistics** - Live vital rates, demographics, and event tracking
- **🎯 Pure Desktop App** - No servers, no databases, no internet required
- **🔄 Hot Reload** - Webpack HMR for instant frontend updates during development

## Architecture

GridWorld is a **pure Tauri v2 desktop application** with all simulation logic running in Rust:

### Communication Layer
- **Pure Tauri IPC** - No HTTP, no WebSocket, no network layer
- **28 Tauri Commands** - Direct Rust function calls from frontend (`invoke()`)
- **Real-time Events** - `calendar-tick` events broadcast simulation updates (`listen()`)
- **ApiClient Singleton** - TypeScript wrapper for all IPC calls

### Core Components
- **Frontend (Three.js)**: Renders 3D hexasphere with indexed geometry, shader-based overlays, and RAF-batched population updates
- **Backend (Tauri)**: 8 command modules (calendar, world, population, people, statistics, tiles, config, memory)
- **Simulation (Rust ECS)**: Uses `hecs` for entity management - people, partnerships, calendar state
- **Calendar Thread**: Background Rust thread auto-ticks simulation (1 day/second or 1 month/125ms)
- **Persistence**: Bincode binary saves (~742KB for 1000 people) with atomic writes

### Data Flow
```
User Action → Three.js Frontend → Tauri invoke() → Rust Command
    ↓                                                      ↓
UI Update ← CalendarManager/PopulationManager ← Tauri Event ← Simulation Tick
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.

## Controls

### Mouse
- **Left click** - Select tile
- **Left drag** - Rotate globe
- **Scroll wheel** - Zoom in/out

### Keyboard
- **W/A/S/D** or **Arrow keys** - Rotate globe
- **+/-** - Zoom in/out
- **C** - Reset camera

### Dashboard
- **Moon button** - Cycle calendar speed (stop / daily / monthly)
- **Tile search** - Jump to tile by ID
- **Menu** - Save, load, restart world

## License

Apache 2.0

## Credits

Based on [hexasphere.js](https://github.com/arscan/hexasphere.js) by Rob Scanlon.
