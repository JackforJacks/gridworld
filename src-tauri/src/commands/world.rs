use tauri::State;

use crate::state::{AppState, CalendarDate, LoadResult, SaveResult, TickEvent};

#[tauri::command]
pub fn tick(state: State<AppState>, count: Option<u32>) -> Result<TickEvent, String> {
    let mut w = state.world.lock().unwrap();
    let n = count.unwrap_or(1);

    let mut total_births: u32 = 0;
    let mut total_deaths: u32 = 0;
    let mut total_marriages: u32 = 0;
    let mut total_pregnancies: u32 = 0;
    let mut total_dissolutions: u32 = 0;

    for _ in 0..n {
        let r = w.tick();
        total_births += r.births;
        total_deaths += r.deaths;
        total_marriages += r.marriages;
        total_pregnancies += r.pregnancies;
        total_dissolutions += r.dissolutions;
    }

    Ok(TickEvent {
        births: total_births,
        deaths: total_deaths,
        marriages: total_marriages,
        pregnancies: total_pregnancies,
        dissolutions: total_dissolutions,
        population: w.entity_count() as u32,
        year: w.calendar.year as i32,
        month: w.calendar.month,
        day: w.calendar.day as u32,
    })
}

#[tauri::command]
pub fn save_world(state: State<AppState>, file_path: String) -> Result<SaveResult, String> {
    let seed = *state.seed.lock().unwrap();
    let w = state.world.lock().unwrap();

    // Stop calendar before saving
    {
        let mut runner = state.calendar_runner.lock().unwrap();
        if let Some(mut r) = runner.take() {
            r.stop();
        }
    }

    let stats = w
        .save_to_file("{}", seed, &file_path)
        .map_err(|e| e.to_string())?;

    Ok(SaveResult {
        population: stats.population,
        file_bytes: stats.file_bytes as i64,
    })
}

#[tauri::command]
pub fn load_world(state: State<AppState>, file_path: String) -> Result<LoadResult, String> {
    // Stop calendar before loading
    {
        let mut runner = state.calendar_runner.lock().unwrap();
        if let Some(mut r) = runner.take() {
            r.stop();
        }
    }

    let mut w = state.world.lock().unwrap();
    let result = w.load_from_file(&file_path).map_err(|e| e.to_string())?;

    // Update seed from loaded data
    *state.seed.lock().unwrap() = result.seed;

    Ok(LoadResult {
        population: result.import_result.population,
        partners: result.import_result.partners,
        calendar_year: result.import_result.calendar_year as i32,
        seed: result.seed,
    })
}

#[tauri::command]
pub fn restart_world(
    state: State<AppState>,
    habitable_tile_ids: Vec<u32>,
    new_seed: Option<u32>,
) -> Result<RestartResult, String> {
    // Stop calendar
    {
        let mut runner = state.calendar_runner.lock().unwrap();
        if let Some(mut r) = runner.take() {
            r.stop();
        }
    }

    // Generate or use provided seed
    let seed = new_seed.unwrap_or_else(|| rand::random::<u32>());
    *state.seed.lock().unwrap() = seed;

    // Reset simulation
    let mut w = state.world.lock().unwrap();
    *w = simulation::world::SimulationWorld::new();

    // Seed population on each habitable tile
    let mut total_population: u32 = 0;
    for tile_id in &habitable_tile_ids {
        let count = w.seed_population_on_tile_range(5, 15, *tile_id as u16);
        total_population += count as u32;
    }

    Ok(RestartResult {
        seed,
        population: total_population,
        tiles: habitable_tile_ids.len() as u32,
        calendar: CalendarDate {
            year: w.calendar.year as i32,
            month: w.calendar.month,
            day: w.calendar.day as u32,
        },
    })
}

#[derive(serde::Serialize, Clone)]
pub struct RestartResult {
    pub seed: u32,
    pub population: u32,
    pub tiles: u32,
    pub calendar: CalendarDate,
}
