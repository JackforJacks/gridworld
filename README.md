GridWorld - Interactive 3D Hexasphere
=====================================

An interactive 3D hexasphere application built with Three.js, featuring real-time population management and modern build tools.

**Features:**
- 🌍 Interactive 3D hexasphere with click-to-select tiles
- 📊 Real-time population counter that updates every second
- 🔄 WebSocket-based live data synchronization
- 🎮 Mouse and keyboard controls for 3D navigation
- 🚀 Modern build system with hot reload
- 💾 Persistent data storage in JSON format

![Screenshot](screenshot.jpg)

## Quick Start

### Development Mode
```bash
npm install
npm run dev
```
Open http://localhost:3000 to see the application with hot reload.

### Production Mode
```bash
npm install
npm run build
npm run server
```
Open http://localhost:8080 to see the production application with population management.

## Population Management

The application includes a real-time population management system:

- **Population Display**: Real-time counter in the top-right corner
- **Auto Growth**: Population increases by 1 every second
- **Data Persistence**: Population data is saved to `data.json`
- **WebSocket Sync**: All connected clients see updates instantly

### API Endpoints

- `GET /api/population` - Get current population data
- `POST /api/population` - Update population count or growth rate
- `GET /api/population/reset` - Reset population to 1,000,000

### Example API Usage

```bash
# Get current population
curl http://localhost:8080/api/population

# Update population to 5 million with growth rate of 2 per second
curl -X POST http://localhost:8080/api/population \
  -H "Content-Type: application/json" \
  -d '{"count": 5000000, "rate": 2}'

# Reset to default
curl http://localhost:8080/api/population/reset
```

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run server` - Start production server
- `npm run prod` - Build and start production server
- `npm run clean` - Clean build artifacts

### Project Structure

```
src/
├── main.js              # Entry point
├── population-manager.js # Real-time population management
├── ui-manager.js         # UI components and population display
├── scene-manager.js      # Three.js scene management
├── camera-controller.js  # Camera controls
├── input-handler.js      # Input event handling
└── Sphere/              # Hexasphere implementation
    ├── hexaSphere.js    # Main sphere generator
    ├── tile.js          # Individual tile logic
    ├── face.js          # Face geometry
    └── ...
```

## Technical Details

### Hexasphere Generation 

```javascript
var radius = 15;        // Radius used to calculate position of tiles
var subDivisions = 5;   // Divide each edge of the icosohedron into this many segments
var tileWidth = 0.9;    // Add padding (1.0 = no padding; 0.1 = mostly padding)

var hexasphere = new Hexasphere(radius, subDivisions, tileWidth);
for(var i = 0; i< hexasphere.tiles.length; i++){
   // hexasphere.tiles[i].centerPoint contains x,y,z of the tile
   // hexasphere.tiles[i].boundary contains an ordered array of the boundary points
   // hexasphere.tiles[i].neighbors contains a list of all the neighboring tiles
}

var waveformObjString = hexasphere.toObj() // export as waveform .obj to use in 3d modelling software
var jsonString = hexasphere.toJson() // export it as a json object

```

Check out a [demo on my website](https://www.robscanlon.com/hexasphere/).  The demo uses Three.js to render the sphere, but that is not an inherit dependency of hexasphere.js.
You can generate a waveform (.obj) model directly from the website, if you don't want to deal with the javascript library.

## GridWorld Development

This project has been enhanced with a modern development setup using Webpack and ES6 modules.

### Development Setup

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev
# Opens http://localhost:3000

# Build for production
npm run build

# Build for development (unminified)
npm run build:dev
```

### Project Structure

```
GridWorld/
├── src/                    # Source code (ES6 modules)
│   ├── main.js            # Application entry point
│   ├── scene-manager.js   # Three.js scene management
│   ├── input-handler.js   # Input handling
│   ├── ui-manager.js      # UI components
│   └── Sphere/            # Hexasphere library
├── css/                   # Stylesheets
├── dist/                  # Production build output
├── webpack.config.js      # Build configuration
└── package.json          # Dependencies and scripts
```

### Features

- **Hot Module Replacement**: See changes instantly while developing
- **Modern JavaScript**: ES6 modules, async/await support
- **Optimized Builds**: Code splitting and minification for production
- **Development Server**: Live reload and error overlay
- **Source Maps**: Debug with original source code

Implementations in Other Languages
--------

If you port this to other languages, let me know and I'll link to it here:

- Objective-C: [pkclsoft/HexasphereDemo](https://github.com/pkclsoft/HexasphereDemo)
- Unity C#: [Em3rgencyLT/Hexasphere](https://github.com/Em3rgencyLT/Hexasphere)

License
--------

The MIT License (MIT) Copyright (c) 2014-2017 Robert Scanlon

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
