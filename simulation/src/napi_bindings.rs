//! N-API bindings for Node.js

use napi::bindgen_prelude::*;
use std::sync::{Arc, Mutex};
use crate::world::SimulationWorld;

type WorldHandle = Arc<Mutex<SimulationWorld>>;

/// Tick result returned to JavaScript
#[napi(object)]
pub struct JsTickResult {
    pub births: u32,
    pub deaths: u32,
    pub marriages: u32,
    pub pregnancies: u32,
    pub dissolutions: u32,
    pub population: u32,
}

#[napi]
pub fn create_world() -> External<WorldHandle> {
    External::new(Arc::new(Mutex::new(SimulationWorld::new())))
}

#[napi]
pub fn seed_population(world: External<WorldHandle>, count: u32) {
    world.lock().unwrap().seed_population(count as usize);
}

#[napi]
pub fn seed_population_on_tile(world: External<WorldHandle>, count: u32, tile_id: u32) {
    world.lock().unwrap().seed_population_on_tile(count as usize, tile_id as u16);
}

#[napi]
pub fn tick(world: External<WorldHandle>) -> JsTickResult {
    let result = world.lock().unwrap().tick();
    JsTickResult {
        births: result.births,
        deaths: result.deaths,
        marriages: result.marriages,
        pregnancies: result.pregnancies,
        dissolutions: result.dissolutions,
        population: result.population,
    }
}

#[napi]
pub fn tick_many(world: External<WorldHandle>, count: u32) -> JsTickResult {
    let mut w = world.lock().unwrap();
    let mut total_births: u32 = 0;
    let mut total_deaths: u32 = 0;
    let mut total_marriages: u32 = 0;
    let mut total_pregnancies: u32 = 0;
    let mut total_dissolutions: u32 = 0;
    for _ in 0..count {
        let r = w.tick();
        total_births += r.births;
        total_deaths += r.deaths;
        total_marriages += r.marriages;
        total_pregnancies += r.pregnancies;
        total_dissolutions += r.dissolutions;
    }
    JsTickResult {
        births: total_births,
        deaths: total_deaths,
        marriages: total_marriages,
        pregnancies: total_pregnancies,
        dissolutions: total_dissolutions,
        population: w.entity_count() as u32,
    }
}

#[napi]
pub fn get_entity_count(world: External<WorldHandle>) -> u32 {
    world.lock().unwrap().entity_count() as u32
}

/// Get actual process memory usage in bytes
#[napi]
pub fn get_memory_bytes(_world: External<WorldHandle>) -> u32 {
    memory_stats::memory_stats()
        .map(|stats| stats.physical_mem as u32)
        .unwrap_or(0)
}

#[napi]
pub fn get_current_day(world: External<WorldHandle>) -> u32 {
    // Return total days since year 4000 (96 days/year)
    let w = world.lock().unwrap();
    let years_since = w.calendar.year.saturating_sub(4000) as u32;
    let days = years_since * 96 
        + (w.calendar.month as u32 - 1) * 8 
        + (w.calendar.day as u32 - 1);
    days
}

#[napi(object)]
pub struct JsCalendar {
    pub day: u32,
    pub month: u8,
    pub year: i32,
}

#[napi]
pub fn get_calendar(world: External<WorldHandle>) -> JsCalendar {
    let w = world.lock().unwrap();
    JsCalendar {
        day: w.calendar.day as u32,
        month: w.calendar.month,
        year: w.calendar.year as i32,
    }
}

#[napi(object)]
pub struct BenchmarkResult {
    pub total_ms: f64,
    pub per_tick_ms: f64,
    pub final_population: u32,
}

// ============================================================================
// Statistics N-API bindings (Phase 2)
// ============================================================================

/// Population count for a single tile
#[napi(object)]
pub struct JsTilePopulation {
    pub tile_id: u32,
    pub count: u32,
}

/// Full demographics snapshot
#[napi(object)]
pub struct JsDemographics {
    pub population: u32,
    pub males: u32,
    pub females: u32,
    pub partnered: u32,
    pub single: u32,
    pub pregnant: u32,
    pub average_age: f64,
    /// Age brackets: [0-4, 5-14, 15-29, 30-49, 50-69, 70-89, 90+]
    pub age_0_4: u32,
    pub age_5_14: u32,
    pub age_15_29: u32,
    pub age_30_49: u32,
    pub age_50_69: u32,
    pub age_70_89: u32,
    pub age_90_plus: u32,
}

/// Get population count for a specific tile
#[napi]
pub fn get_tile_population(world: External<WorldHandle>, tile_id: u32) -> u32 {
    world.lock().unwrap().tile_population(tile_id as u16)
}

/// Get population count per tile
#[napi]
pub fn get_population_by_tile(world: External<WorldHandle>) -> Vec<JsTilePopulation> {
    let w = world.lock().unwrap();
    let map = w.population_by_tile();
    let mut result: Vec<JsTilePopulation> = map
        .into_iter()
        .map(|(tile_id, count)| JsTilePopulation {
            tile_id: tile_id as u32,
            count,
        })
        .collect();
    result.sort_by_key(|t| t.tile_id);
    result
}

/// Get full demographics snapshot (single pass over all entities)
#[napi]
pub fn get_demographics(world: External<WorldHandle>) -> JsDemographics {
    let w = world.lock().unwrap();
    let d = w.demographics();
    JsDemographics {
        population: d.population,
        males: d.males,
        females: d.females,
        partnered: d.partnered,
        single: d.single,
        pregnant: d.pregnant,
        average_age: d.average_age,
        age_0_4: d.age_brackets[0],
        age_5_14: d.age_brackets[1],
        age_15_29: d.age_brackets[2],
        age_30_49: d.age_brackets[3],
        age_50_69: d.age_brackets[4],
        age_70_89: d.age_brackets[5],
        age_90_plus: d.age_brackets[6],
    }
}

#[napi]
pub fn run_benchmark(initial_population: u32, ticks: u32) -> BenchmarkResult {
    use std::time::Instant;
    
    let mut world = SimulationWorld::new();
    world.seed_population(initial_population as usize);
    
    let start = Instant::now();
    for _ in 0..ticks {
        let _ = world.tick();
    }
    let elapsed = start.elapsed();
    
    BenchmarkResult {
        total_ms: elapsed.as_secs_f64() * 1000.0,
        per_tick_ms: (elapsed.as_secs_f64() * 1000.0) / ticks as f64,
        final_population: world.entity_count() as u32,
    }
}

// ============================================================================
// Persistence N-API bindings (Phase 4)
// ============================================================================

/// Result of import operation
#[napi(object)]
pub struct JsImportResult {
    pub population: u32,
    pub partners: u32,
    pub mothers: u32,
    pub calendar_year: i32,
}

/// Export entire world state to JSON string
#[napi]
pub fn export_world(world: External<WorldHandle>) -> String {
    world.lock().unwrap().export_world()
}

/// Import world state from JSON string, replacing current state
/// Returns import statistics or throws on error
#[napi]
pub fn import_world(world: External<WorldHandle>, json: String) -> napi::Result<JsImportResult> {
    let result = world.lock().unwrap().import_world(&json)
        .map_err(|e| napi::Error::from_reason(e))?;
    
    Ok(JsImportResult {
        population: result.population,
        partners: result.partners,
        mothers: result.mothers,
        calendar_year: result.calendar_year as i32,
    })
}
