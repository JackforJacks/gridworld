//! N-API bindings for Node.js

use napi::bindgen_prelude::*;
use std::sync::{Arc, Mutex};
use crate::world::SimulationWorld;

type WorldHandle = Arc<Mutex<SimulationWorld>>;

#[napi]
pub fn create_world() -> External<WorldHandle> {
    External::new(Arc::new(Mutex::new(SimulationWorld::new())))
}

#[napi]
pub fn seed_population(world: External<WorldHandle>, count: u32) {
    world.lock().unwrap().seed_population(count as usize);
}

#[napi]
pub fn tick(world: External<WorldHandle>) {
    world.lock().unwrap().tick();
}

#[napi]
pub fn tick_many(world: External<WorldHandle>, count: u32) {
    let mut w = world.lock().unwrap();
    for _ in 0..count {
        w.tick();
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
pub fn get_current_tick(world: External<WorldHandle>) -> u32 {
    world.lock().unwrap().current_tick as u32
}

#[napi(object)]
pub struct JsCalendar {
    pub tick: u32,
    pub month: u8,
    pub year: i32,
}

#[napi]
pub fn get_calendar(world: External<WorldHandle>) -> JsCalendar {
    let w = world.lock().unwrap();
    JsCalendar {
        tick: w.calendar.tick as u32,
        month: w.calendar.month,
        year: w.calendar.year,
    }
}

#[napi(object)]
pub struct BenchmarkResult {
    pub total_ms: f64,
    pub per_tick_ms: f64,
    pub final_population: u32,
}

#[napi]
pub fn run_benchmark(initial_population: u32, ticks: u32) -> BenchmarkResult {
    use std::time::Instant;
    
    let mut world = SimulationWorld::new();
    world.seed_population(initial_population as usize);
    
    let start = Instant::now();
    for _ in 0..ticks {
        world.tick();
    }
    let elapsed = start.elapsed();
    
    BenchmarkResult {
        total_ms: elapsed.as_secs_f64() * 1000.0,
        per_tick_ms: (elapsed.as_secs_f64() * 1000.0) / ticks as f64,
        final_population: world.entity_count() as u32,
    }
}
