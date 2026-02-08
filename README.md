# GridWorld

A Tauri v2 desktop application featuring an interactive 3D hexasphere world simulation with real-time population dynamics, built with Three.js and a Rust ECS simulation engine.

## Prerequisites

- **Node.js** >= 18.0.0
- **Rust** >= 1.70 (install via [rustup.rs](https://rustup.rs/))
- **Tauri v2 system dependencies** (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
  - Windows: Microsoft Visual Studio C++ Build Tools, WebView2
  - Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
  - macOS: Xcode Command Line Tools

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

## Architecture

GridWorld is a **Tauri v2 desktop app** with all simulation logic running in Rust:

- **Frontend**: Three.js renders a 3D hexasphere. TypeScript managers communicate with the backend via Tauri IPC (`invoke()` for commands, `listen()` for events).
- **Backend**: Tauri commands call into the `simulation` Rust library, which uses an ECS architecture (hecs) for people, relationships, and calendar state.
- **Simulation**: A background Rust thread ticks the calendar automatically, running aging, death, birth, and matchmaking systems each tick. Results are emitted as Tauri events.
- **Persistence**: World state is saved to binary files (`saves/world.bin`) using bincode serialization. No external databases required.

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

MIT License - Copyright (c) 2014-2017 Robert Scanlon

## Credits

Based on [hexasphere.js](https://github.com/arscan/hexasphere.js) by Rob Scanlon.
