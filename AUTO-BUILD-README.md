# GridWorld Auto-Build System

## Overview
This auto-build system provides automatic rebuilding of your GridWorld application when files change. It includes multiple build modes for different development scenarios.

## Available Scripts

### Development Auto-Build Scripts

1. **`npm run auto-build`** - Frontend watch mode only
   - Watches frontend files (src/, css/, index.html)
   - Rebuilds webpack bundle automatically on changes
   - Minimal output for cleaner terminal

2. **`npm run server:watch`** - Backend watch mode only
   - Watches server.js and related files
   - Restarts Node.js server automatically on changes
   - Uses nodemon for intelligent restart detection

3. **`npm run full-auto`** - Complete auto-build system
   - Runs both frontend and backend watch modes simultaneously
   - Best option for full-stack development
   - Uses `concurrently` to manage both processes

### Other Build Scripts

4. **`npm run build:watch`** - Development build with watch
   - Development webpack build with file watching
   - More verbose output than auto-build

5. **`npm run build:watch:prod`** - Production build with watch
   - Production-optimized build with file watching
   - Includes minification and compression

6. **`npm run dev`** - Development server
   - Webpack dev server with hot reload
   - Serves files directly from memory (faster)

7. **`npm run build`** - Production build
   - Single production build without watching
   - Creates optimized dist/ folder

## VS Code Integration

### Tasks Available (Ctrl+Shift+P → "Tasks: Run Task")

1. **Auto Build (Watch Mode)** - Default build task
2. **Server Watch Mode** - Backend only
3. **Full Auto Build & Server** - Complete system
4. **Build Production** - One-time production build
5. **Clean Build** - Removes dist/ folder

### VS Code Launch Configurations (F5)

1. **Launch GridWorld Dev Server** - Debug webpack dev server
2. **Launch Node.js Server** - Debug backend server with nodemon
3. **Launch Full GridWorld** - Debug both frontend and backend

## File Watching Configuration

### Webpack Watch Options
- **Aggregate Timeout**: 300ms (delays rebuild after changes)
- **Poll Interval**: 1000ms (checks for changes every second)
- **Ignored**: node_modules/ (for better performance)

### Nodemon Watch Configuration
- **Watches**: server.js, src/**/*.js, package.json
- **Extensions**: .js, .json
- **Ignores**: dist/, node_modules/, test files
- **Delay**: 1000ms (restart delay)

## Performance Optimizations

### Bundle Splitting
- **three.js**: Separate chunk (648 KiB)
- **socket.io**: Separate chunk when large enough
- **vendors**: Other dependencies (40.5 KiB)
- **main**: Application code (58.1 KiB)

### Watch Mode Optimizations
- **No Clean**: Skips cleaning dist/ in watch mode for faster rebuilds
- **Caching**: Webpack caches unchanged modules
- **HMR**: Hot Module Replacement for instant updates in dev server
- **Polling**: Uses efficient file system watching

## Quick Start

### For Frontend Development Only:
```bash
npm run auto-build
```

### For Backend Development Only:
```bash
npm run server:watch
```

### For Full-Stack Development:
```bash
npm run full-auto
```

### For Production Deployment:
```bash
npm run build
npm run server
```

## Troubleshooting

### If builds are slow:
- Check that node_modules/ is ignored in watch patterns
- Ensure antivirus isn't scanning dist/ folder
- Use SSD drive for better file I/O performance

### If hot reload isn't working:
- Try `npm run dev` instead for webpack dev server
- Check browser console for WebSocket connection errors
- Verify port 8080 isn't blocked by firewall

### If nodemon isn't restarting:
- Check nodemon.json configuration
- Verify file patterns in watch configuration
- Use `rs` command in terminal to manually restart

## File Structure Impact

The auto-build system watches these directories:
```
src/           - Frontend JavaScript modules
css/           - Stylesheets  
index.html     - HTML template
server.js      - Backend server
package.json   - Dependencies and scripts
```

Changes to any of these files will trigger appropriate rebuilds automatically.
