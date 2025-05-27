// Modularized imports
const { fetchTileDataFromServer, postInitialDataToServer, clearServerData, exportTileDataToServer } = require('./data');
const { createScene, tick, onWindowResize, onMouseWheel, onMouseDown, onMouseMove, onMouseUp, checkTileIntersection } = require('./scene');
const { initializeAndStartGame } = require('./init');

// Global variables for scene state
let sceneInitialized = false;
let scene, camera, renderer;
let hexasphere = null;
let currentTiles = [];

// Create a global mouse state object for better state management
window.mouseState = {
    isDragging: false,
    previousPosition: { x: 0, y: 0 },
    initialPosition: { x: 0, y: 0 },
    clickStartTime: 0
};

// Create a global rotation state object for vertical axis rotation
window.rotationState = {
    current: { x: 0, y: 0 }, // x = elevation angle, y = azimuth angle
    target: { x: 0, y: 0 },
    autoRotate: true // Start with auto-rotation enabled for natural Earth-like behavior
};

let cameraDistance = 65;
const minCameraDistance = 40; 
const maxCameraDistance = 120;
let borderLines = null; 
const borderLineMaterial = new THREE.LineBasicMaterial({
    color: 0xff0000, 
    depthTest: false, 
    transparent: false, 
    opacity: 1
});
let tilePopup;
let selectedTile = null; // Define selectedTile at the top level

// Define raycaster at the top level so it is available for mouse event handlers
const raycaster = new THREE.Raycaster();
const mousePosition = new THREE.Vector2();

// Basic initialization
window.addEventListener('load', async () => { 

    if (typeof THREE === 'undefined') {
        console.error("THREE.js not detected. Ensure that three.min.js or equivalent is included and loaded before main.js.");
        return; 
    }

    // Set up basic THREE.js components
    const width = window.innerWidth;
    const height = window.innerHeight - 10; 
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0); // Transparent background

    camera = new THREE.PerspectiveCamera(45, width / height, 1, 200);
    // Set initial camera position for proper vertical axis viewing
    camera.position.set(0, 0, cameraDistance);

    scene = new THREE.Scene();
    
    // Get references to DOM elements
    tilePopup = document.getElementById('tilePopup');
    
    const container = document.getElementById("container");
    if (container) {
        container.appendChild(renderer.domElement);
    } else {
        console.error("Container element not found in HTML. Cannot append renderer.");
        return;
    }

    // Assign main.js scene state variables to window object
    // for access by other modules like init.js
    window.scene = scene;
    window.renderer = renderer;
    window.camera = camera;
    window.hexasphere = hexasphere; // hexasphere is initially null, createScene reassigns window.hexasphere
    window.currentTiles = currentTiles;
    window.tilePopup = tilePopup; // tilePopup is assigned from getElementById

    window.borderLines = borderLines;
    window.cameraDistance = cameraDistance;
    window.minCameraDistance = minCameraDistance;
    window.maxCameraDistance = maxCameraDistance;
    // Note: updateDashboardFromECSY is handled in init.js directly

    // Set up event listeners
    window.addEventListener('resize', () => onWindowResize(camera, renderer), false); 
    window.addEventListener('wheel', (e) => onMouseWheel(e, cameraDistance, minCameraDistance, maxCameraDistance, (newCamDist) => cameraDistance = newCamDist), { passive: false }); 
    
    // Attach all mouse events to the renderer canvas for consistency
    renderer.domElement.addEventListener('mousedown', (e) => onMouseDown(e, mouseState.isDragging, rotationState.autoRotate, mouseState.clickStartTime, mouseState.previousPosition, mouseState.initialPosition, mousePosition, renderer, (newIsDragging, newAutoRotate, newClickStartTime, newPrevMousePos, newInitialMousePos, newMousePos) => { 
        mouseState.isDragging = newIsDragging; 
        rotationState.autoRotate = newAutoRotate; 
        mouseState.clickStartTime = newClickStartTime; 
        mouseState.previousPosition = newPrevMousePos; 
        mouseState.initialPosition = newInitialMousePos; 
        mousePosition.x = newMousePos.x;
        mousePosition.y = newMousePos.y;
    }), { passive: false }); 
    
    renderer.domElement.addEventListener('mousemove', (e) => {
        // Remove preventDefault to avoid passive event listener warning
        if (!mouseState.isDragging) return;
        const deltaX = e.clientX - mouseState.previousPosition.x;
        const deltaY = e.clientY - mouseState.previousPosition.y;
        const rotationSpeed = 0.005;
        rotationState.target.y -= deltaX * rotationSpeed;
        rotationState.target.x += deltaY * rotationSpeed;
        rotationState.target.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, rotationState.target.x));
        mouseState.previousPosition.x = e.clientX;
        mouseState.previousPosition.y = e.clientY;
        if (tilePopup) {
            tilePopup.style.display = 'none';
        }
    }, { passive: true }); 
    
    renderer.domElement.addEventListener('mouseup', (e) => onMouseUp(e, mouseState.isDragging, rotationState.autoRotate, mouseState.clickStartTime, mouseState.initialPosition, rotationState.current, rotationState.target, currentTiles, scene, camera, raycaster, selectedTile, borderLines, borderLineMaterial, tilePopup, hexasphere, (newIsDragging, newAutoRotate, newTargetRotX, newTargetRotY, newSelectedTile, newBorderLines) => { 
        mouseState.isDragging = newIsDragging; 
        rotationState.autoRotate = newAutoRotate; 
        rotationState.current.x = newTargetRotX; 
        rotationState.current.y = newTargetRotY; 
        selectedTile = newSelectedTile; 
        borderLines = newBorderLines; 
    }), { passive: false }); 
    
    // Also handle mouse leave to stop dragging when mouse leaves canvas
    renderer.domElement.addEventListener('mouseleave', (e) => {
        if (mouseState.isDragging) {
            mouseState.isDragging = false;
        }
    }); 

    document.addEventListener('click', (event) => {
        // Check if clicking outside the canvas or not on a tile
        if (!container.contains(event.target) || event.target === container) {
            // Hide popup and remove border when clicking outside
            if (tilePopup) {
                tilePopup.style.display = 'none';
            }
            if (borderLines) {
                scene.remove(borderLines);
                borderLines = null;
            }
            selectedTile = null;
        }
    });

    // Set up controls panel toggle
    const toggleHelpButton = document.getElementById('toggle-help');
    const controlsPanel = document.getElementById('controls-help');
    
    if (toggleHelpButton && controlsPanel) {
        toggleHelpButton.addEventListener('click', () => {
            controlsPanel.classList.toggle('collapsed');
            toggleHelpButton.textContent = controlsPanel.classList.contains('collapsed') ? '?' : '×';
        });
        
        // Initially show the controls for a few seconds, then collapse
        setTimeout(() => {
            controlsPanel.classList.add('collapsed');
            toggleHelpButton.textContent = '?';
        }, 5000);
    }

    // Add keyboard controls for enhanced zoom and rotation
    window.addEventListener('keydown', (event) => {
        const step = 0.1; // Rotation step size
        const zoomStep = 2; // Zoom step size
        
        switch(event.key.toLowerCase()) {
            case 'w': // Rotate up
            case 'arrowup':
                event.preventDefault();
                rotationState.target.x -= step;
                rotationState.target.x = Math.max(-Math.PI/2, rotationState.target.x);
                rotationState.autoRotate = false;
                break;
                
            case 's': // Rotate down
            case 'arrowdown':
                event.preventDefault();
                rotationState.target.x += step;
                rotationState.target.x = Math.min(Math.PI/2, rotationState.target.x);
                rotationState.autoRotate = false;
                break;
                
            case 'a': // Rotate left
            case 'arrowleft':
                event.preventDefault();
                rotationState.target.y -= step;
                rotationState.autoRotate = false;
                break;
                
            case 'd': // Rotate right
            case 'arrowright':
                event.preventDefault();
                rotationState.target.y += step;
                rotationState.autoRotate = false;
                break;
                
            case '=': // Zoom in
            case '+':
                event.preventDefault();
                cameraDistance = Math.max(minCameraDistance, cameraDistance - zoomStep);
                break;
                
            case '-': // Zoom out
            case '_':
                event.preventDefault();
                cameraDistance = Math.min(maxCameraDistance, cameraDistance + zoomStep);
                break;
                
            case 'r': // Reset rotation and enable auto-rotate
                event.preventDefault();
                rotationState.target.x = 0;
                rotationState.target.y = 0;
                rotationState.autoRotate = true;
                break;
                
            case 'c': // Center camera and reset zoom
                event.preventDefault();
                cameraDistance = 65; // Reset to default
                rotationState.target.x = 0;
                rotationState.target.y = 0;
                break;
        }
    }, { passive: false });

    if (typeof createStars === 'function') createStars(); 
    
    // Initialize the scene automatically
    initializeAndStartGame();
    
    // Start the render loop
    let lastTime = Date.now(); 

    function renderLoop() {
        tick( // Imported from scene.js
            lastTime,
            rotationState.autoRotate,
            rotationState.target,
            rotationState.current,
            camera,
            scene,
            renderer,
            cameraDistance,
            (newLastTime, updatedRotation, updatedTargetRotation) => { // Callback to update main.js state
                lastTime = newLastTime;
                rotationState.current = updatedRotation;
                rotationState.target = updatedTargetRotation;
            }
            // world parameter removed - no longer using ECSY
        );
        requestAnimationFrame(renderLoop); // Continue the loop
    }
    requestAnimationFrame(renderLoop); // Start the loop

    window.scene = scene; 
    window.createScene = createScene; 
});

// Note: createScene and other scene functions are imported from scene.js
