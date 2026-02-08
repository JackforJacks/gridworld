use serde::Deserialize;
use tauri::State;

use crate::state::{AppState, TileProperties};

#[derive(Deserialize)]
pub struct TileCenter {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Calculate tile properties for a batch of tiles from their center coordinates.
/// This is a port of the server-side calculateTileProperties() function.
#[tauri::command]
pub fn calculate_tile_properties(
    state: State<AppState>,
    tiles: Vec<TileCenter>,
) -> Vec<TileProperties> {
    let seed = *state.seed.lock().unwrap();
    tiles
        .iter()
        .map(|tile| {
            let terrain = calculate_terrain(tile.x, tile.y, tile.z, seed);
            let biome = calculate_biome(tile.x, tile.y, tile.z, &terrain, seed);
            let fertility = calculate_fertility(tile.x, tile.y, tile.z, biome.as_deref(), &terrain, seed);
            let is_habitable = check_habitable(&terrain, biome.as_deref());

            TileProperties {
                id: tile.id,
                terrain_type: terrain,
                biome,
                fertility,
                is_habitable,
            }
        })
        .collect()
}

// -- Terrain generation (ported from server/services/terrain/index.ts) --

fn position_hash(x: f64, y: f64, z: f64, seed: f64) -> f64 {
    let h1 = (x * 12.9898 + y * 78.233 + z * 45.164 + seed * 0.001).sin() * 43758.5453;
    let h2 = (x * 39.346 + y * 11.135 + z * 83.155 + seed * 0.002).sin() * 93751.1459;
    let combined = h1 + h2;
    combined - combined.floor()
}

struct PositionRandom {
    x: f64,
    y: f64,
    z: f64,
    seed: f64,
    sample: u32,
}

impl PositionRandom {
    fn new(x: f64, y: f64, z: f64, seed: f64) -> Self {
        Self { x, y, z, seed, sample: 0 }
    }

    fn next(&mut self) -> f64 {
        self.sample += 1;
        let s = self.sample as f64;
        position_hash(
            self.x + s * 0.137,
            self.y + s * 0.293,
            self.z + s * 0.419,
            self.seed,
        )
    }
}

fn calculate_terrain(x: f64, y: f64, z: f64, seed: u32) -> String {
    let seed_f = seed as f64;
    let p1 = position_hash(seed_f, seed_f * 0.7, seed_f * 0.3, 0.0) * std::f64::consts::TAU;
    let p2 = position_hash(seed_f * 0.5, seed_f, seed_f * 0.9, 0.0) * std::f64::consts::TAU;
    let p3 = position_hash(seed_f * 0.3, seed_f * 0.6, seed_f, 0.0) * std::f64::consts::TAU;
    let p4 = position_hash(seed_f * 0.8, seed_f * 0.2, seed_f * 0.5, 0.0) * std::f64::consts::TAU;

    let c1 = (x * 0.10 + p1).sin() * (z * 0.12 + p2).cos();
    let c2 = (z * 0.14 + p3).sin() * (y * 0.10 + p1).cos() * 0.6;
    let c3 = (y * 0.12 + p2).sin() * (x * 0.08 + p4).cos() * 0.4;
    let c4 = (x * 0.22 + z * 0.18 + p4).sin() * 0.25;

    let continent_mask = c1 + c2 + c3 + c4;
    let land_threshold = -0.05;

    if continent_mask < land_threshold {
        return "ocean".into();
    }

    let land_height = continent_mask - land_threshold;
    let detail1 = (x * 0.35 + z * 0.30 + p1).sin() * (y * 0.32 + p2).cos() * 0.12;
    let detail2 = position_hash(x, y, z, seed_f) * 0.08 - 0.04;
    let elevation = land_height + detail1 + detail2;

    if elevation > 0.7 {
        "mountains".into()
    } else if elevation > 0.4 {
        "hills".into()
    } else {
        "flats".into()
    }
}

fn calculate_biome(x: f64, y: f64, z: f64, terrain: &str, seed: u32) -> Option<String> {
    if terrain == "ocean" {
        return None;
    }
    if terrain == "mountains" {
        return Some("alpine".into());
    }

    let radius = (x * x + y * y + z * z).sqrt();
    let latitude = (y / radius).asin().to_degrees().abs();
    let mut rng = PositionRandom::new(x, y, z, seed as f64);

    if latitude > 60.0 {
        Some(if rng.next() < 0.8 { "tundra" } else { "alpine" }.into())
    } else if latitude > 45.0 {
        Some(if rng.next() < 0.7 { "plains" } else { "tundra" }.into())
    } else if latitude > 30.0 {
        Some(if rng.next() < 0.6 { "grassland" } else { "plains" }.into())
    } else if latitude > 15.0 {
        Some(if rng.next() < 0.5 { "grassland" } else { "desert" }.into())
    } else {
        Some(if rng.next() < 0.7 { "grassland" } else { "desert" }.into())
    }
}

fn calculate_fertility(x: f64, y: f64, z: f64, biome: Option<&str>, terrain: &str, seed: u32) -> u32 {
    let biome = match biome {
        Some(b) if terrain != "ocean" && terrain != "mountains" => b,
        _ => return 0,
    };

    let base: i32 = match biome {
        "grassland" => 80,
        "plains" => 70,
        "desert" => 20,
        "tundra" => 30,
        "alpine" => 25,
        _ => 50,
    };

    let mut rng = PositionRandom::new(x, y, z, (seed + 1000) as f64);
    let variation = ((rng.next() - 0.5) * 20.0) as i32;
    (base + variation).clamp(0, 100) as u32
}

fn check_habitable(terrain: &str, biome: Option<&str>) -> bool {
    if terrain == "ocean" || terrain == "mountains" {
        return false;
    }
    match biome {
        Some("desert") | Some("tundra") | Some("alpine") => false,
        _ => true,
    }
}
