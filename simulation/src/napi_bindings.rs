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
pub fn seed_population_on_tile_range(world: External<WorldHandle>, min: u32, max: u32, tile_id: u32) -> u32 {
    world.lock().unwrap().seed_population_on_tile_range(min as usize, max as usize, tile_id as u16) as u32
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

// ============================================================================
// File-based persistence (bincode)
// ============================================================================

/// Result of save_to_file
#[napi(object)]
pub struct JsSaveStats {
    pub population: u32,
    pub file_bytes: i64,
}

/// Result of load_from_file
#[napi(object)]
pub struct JsLoadFileResult {
    pub population: u32,
    pub partners: u32,
    pub mothers: u32,
    pub calendar_year: i32,
    pub seed: u32,
    pub node_state_json: String,
}

/// Save world + Node state to a bincode file
#[napi]
pub fn save_to_file(
    world: External<WorldHandle>,
    node_state_json: String,
    seed: u32,
    file_path: String,
) -> napi::Result<JsSaveStats> {
    let w = world.lock().unwrap();
    let stats = w.save_to_file(&node_state_json, seed, &file_path)
        .map_err(|e| napi::Error::from_reason(e))?;

    Ok(JsSaveStats {
        population: stats.population,
        file_bytes: stats.file_bytes as i64,
    })
}

/// Load world + Node state from a bincode file
#[napi]
pub fn load_from_file(
    world: External<WorldHandle>,
    file_path: String,
) -> napi::Result<JsLoadFileResult> {
    let mut w = world.lock().unwrap();
    let result = w.load_from_file(&file_path)
        .map_err(|e| napi::Error::from_reason(e))?;

    Ok(JsLoadFileResult {
        population: result.import_result.population,
        partners: result.import_result.partners,
        mothers: result.import_result.mothers,
        calendar_year: result.import_result.calendar_year as i32,
        seed: result.seed,
        node_state_json: result.node_state_json,
    })
}

// ============================================================================
// ID Allocation
// ============================================================================

/// Get next person ID (increments internal counter)
#[napi]
pub fn get_next_person_id(world: External<WorldHandle>) -> i64 {
    let mut w = world.lock().unwrap();
    let id = w.next_person_id;
    w.next_person_id += 1;
    id as i64
}

/// Get a batch of person IDs (more efficient than calling get_next_person_id repeatedly)
#[napi]
pub fn get_person_id_batch(world: External<WorldHandle>, count: u32) -> Vec<i64> {
    let mut w = world.lock().unwrap();
    let start = w.next_person_id;
    w.next_person_id += count as u64;
    (start..start + count as u64).map(|id| id as i64).collect()
}

// ============================================================================
// Calendar Auto-Ticking (Phase 1 - Rust-controlled timer)
// ============================================================================

use crate::calendar_runner::CalendarRunner;
use std::sync::Mutex as StdMutex;
use once_cell::sync::Lazy;
use napi::threadsafe_function::{
    ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy,
};

/// Global calendar runner (one per process)
static CALENDAR_RUNNER: Lazy<StdMutex<Option<CalendarRunner>>> = Lazy::new(|| StdMutex::new(None));

/// Extended tick result with calendar state for Node.js callbacks
#[napi(object)]
pub struct JsTickEvent {
    pub births: u32,
    pub deaths: u32,
    pub marriages: u32,
    pub pregnancies: u32,
    pub dissolutions: u32,
    pub population: u32,
    pub year: i32,
    pub month: u8,
    pub day: u32,
}

/// Start the calendar auto-ticking in a background Rust thread
///
/// # Arguments
/// * `world` - The simulation world
/// * `interval_ms` - Milliseconds between ticks (1000 = daily speed, 125 = monthly speed)
/// * `callback` - JavaScript function to call on each tick with tick results
///
/// # Example (Node.js)
/// ```js
/// rustSimulation.startCalendar(world, 1000, (tickEvent) => {
///     console.log(`Tick: ${tickEvent.births} births, ${tickEvent.deaths} deaths`);
///     io.emit('calendarTick', tickEvent);
/// });
/// ```
#[napi]
pub fn start_calendar(
    world: External<WorldHandle>,
    interval_ms: u32,
    callback: JsFunction,
) -> napi::Result<()> {
    // Create threadsafe function that can be called from Rust thread
    let tsfn: ThreadsafeFunction<JsTickEvent, ErrorStrategy::Fatal> = callback
        .create_threadsafe_function(0, |ctx| {
            Ok(vec![ctx.value])
        })?;

    // Clone the Arc for the runner thread
    let world_clone = Arc::clone(&world);

    // Create and start the calendar runner
    let mut runner = CalendarRunner::new();
    runner.start(
        world_clone,
        interval_ms as u64,
        move |tick_result| {
            // Get calendar state
            let calendar = {
                let w = world.lock().unwrap();
                JsCalendar {
                    day: w.calendar.day as u32,
                    month: w.calendar.month,
                    year: w.calendar.year as i32,
                }
            };

            // Create event data for JavaScript
            let event = JsTickEvent {
                births: tick_result.births,
                deaths: tick_result.deaths,
                marriages: tick_result.marriages,
                pregnancies: tick_result.pregnancies,
                dissolutions: tick_result.dissolutions,
                population: tick_result.population,
                year: calendar.year,
                month: calendar.month,
                day: calendar.day,
            };

            // Call JavaScript callback from Rust thread (non-blocking)
            tsfn.call(event, ThreadsafeFunctionCallMode::NonBlocking);
        },
    );

    // Store the runner globally
    let mut global_runner = CALENDAR_RUNNER.lock().unwrap();
    *global_runner = Some(runner);

    Ok(())
}

/// Stop the calendar auto-ticking
#[napi]
pub fn stop_calendar() -> napi::Result<()> {
    let mut global_runner = CALENDAR_RUNNER.lock().unwrap();
    if let Some(mut runner) = global_runner.take() {
        runner.stop();
    }
    Ok(())
}

/// Check if calendar is currently running
#[napi]
pub fn is_calendar_running() -> bool {
    let global_runner = CALENDAR_RUNNER.lock().unwrap();
    global_runner.as_ref().map(|r| r.is_running()).unwrap_or(false)
}
