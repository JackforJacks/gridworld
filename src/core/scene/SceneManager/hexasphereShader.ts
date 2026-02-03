// Hexasphere Shader Material
// GPU-based color computation for improved performance
import * as THREE from 'three';

/**
 * Biome/terrain color palette (as vec3 colors in 0-1 range)
 * Order: ocean, desert, tundra, grassland, plains, alpine
 */
const BIOME_COLORS = [
    [0.29, 0.56, 0.89],  // 0: ocean (#4A90E2)
    [0.96, 0.64, 0.38],  // 1: desert (#F4A460)
    [1.00, 1.00, 1.00],  // 2: tundra (white)
    [0.30, 0.69, 0.31],  // 3: grassland (#4CAF50)
    [0.56, 0.74, 0.56],  // 4: plains (#8FBC8F)
    [0.55, 0.27, 0.07],  // 5: alpine (#8B4513)
    [0.50, 0.50, 0.50],  // 6: unknown (gray fallback)
];

/**
 * Map biome string to index for shader
 */
export function getBiomeIndex(biome: string | null | undefined, terrainType: string | null | undefined): number {
    if (terrainType === 'ocean') return 0;
    switch (biome) {
        case 'desert': return 1;
        case 'tundra': return 2;
        case 'grassland': return 3;
        case 'plains': return 4;
        case 'alpine': return 5;
        default: return 6;
    }
}

/**
 * Vertex shader - passes biome index, world position and normal to fragment shader
 */
const vertexShader = `
    attribute float biomeIndex;
    
    varying float vBiomeIndex;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    
    void main() {
        vBiomeIndex = biomeIndex;
        vNormal = normalize(normalMatrix * normal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/**
 * Fragment shader - computes color from biome index with spotlight from camera
 * Note: Uses explicit if-else for array access (WebGL 1.0 compatibility)
 * Note: Uses 'lightPosition' instead of 'cameraPosition' to avoid Three.js builtin conflict
 */
const fragmentShader = `
    precision highp float;
    
    uniform vec3 biomeColors[7];
    uniform vec3 lightPosition;
    uniform float ambientIntensity;
    uniform float diffuseIntensity;
    uniform float spotlightFalloff;
    
    varying float vBiomeIndex;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    
    // WebGL 1.0 compatible array lookup (no dynamic indexing)
    vec3 getBiomeColor(float idx) {
        if (idx < 0.5) return biomeColors[0];
        else if (idx < 1.5) return biomeColors[1];
        else if (idx < 2.5) return biomeColors[2];
        else if (idx < 3.5) return biomeColors[3];
        else if (idx < 4.5) return biomeColors[4];
        else if (idx < 5.5) return biomeColors[5];
        else return biomeColors[6];
    }
    
    void main() {
        // Get biome color from palette
        vec3 baseColor = getBiomeColor(vBiomeIndex);
        
        // Light direction from surface point to light (stationary spotlight)
        vec3 lightDir = normalize(lightPosition - vWorldPosition);
        vec3 normal = normalize(vNormal);
        
        // Diffuse lighting
        float diffuse = max(dot(normal, lightDir), 0.0);
        
        // Apply falloff to create spotlight effect (darker at edges)
        float spotEffect = pow(diffuse, spotlightFalloff);
        
        // Combine ambient and spotlight
        vec3 finalColor = baseColor * (ambientIntensity + diffuseIntensity * spotEffect);
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

/**
 * Create hexasphere shader material
 */
export function createHexasphereShaderMaterial(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            biomeColors: { value: BIOME_COLORS.map(c => new THREE.Vector3(c[0], c[1], c[2])) },
            lightPosition: { value: new THREE.Vector3(0, 0, 100) },
            ambientIntensity: { value: 0.3 },
            diffuseIntensity: { value: 0.7 },
            spotlightFalloff: { value: 2.0 }  // Higher = tighter spotlight
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide
    });

    return material;
}

/**
 * Update camera position uniform for spotlight effect
 */
export function updateCameraPosition(material: THREE.ShaderMaterial, position: THREE.Vector3): void {
    material.uniforms.lightPosition.value.copy(position);
}

/**
 * Update light direction uniform (legacy - now uses camera position)
 */
export function updateLightDirection(material: THREE.ShaderMaterial, direction: THREE.Vector3): void {
    // Kept for compatibility - direction is now computed from camera position
    // This function is no longer needed but kept to avoid breaking changes
}
