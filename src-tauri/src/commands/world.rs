use tauri::State;

use crate::state::{AppState, CalendarDate, LoadResult, SaveResult, TickEvent, WorldConfig};

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
pub fn save_world(
    state: State<AppState>,
    file_path: String,
    world_config: Option<WorldConfig>,
) -> Result<SaveResult, String> {
    let seed = *state.seed.lock().unwrap();
    let w = state.world.lock().unwrap();

    // Stop calendar before saving
    {
        let mut runner = state.calendar_runner.lock().unwrap();
        if let Some(mut r) = runner.take() {
            r.stop();
        }
    }

    let config_json = match &world_config {
        Some(cfg) => serde_json::to_string(cfg).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    };

    let stats = w
        .save_to_file(&config_json, seed, &file_path)
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

    // Parse world config from node_state JSON
    let world_config: WorldConfig =
        serde_json::from_str(&result.node_state_json).unwrap_or_default();

    Ok(LoadResult {
        population: result.import_result.population,
        partners: result.import_result.partners,
        calendar_year: result.import_result.calendar_year as i32,
        seed: result.seed,
        world_config,
    })
}

#[tauri::command]
pub fn check_save_exists(file_path: String) -> bool {
    std::path::Path::new(&file_path).exists()
}

#[tauri::command]
pub fn restart_world(
    state: State<AppState>,
    habitable_tile_ids: Vec<u32>,
    new_seed: Option<u32>,
    tile_percent: Option<u32>,
    pop_min: Option<usize>,
    pop_max: Option<usize>,
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

    // Determine how many tiles to seed based on tile_percent
    let pct = tile_percent.unwrap_or(40).clamp(1, 100) as usize;
    let tiles_to_seed = (habitable_tile_ids.len() * pct + 99) / 100; // ceil division
    let min = pop_min.unwrap_or(5);
    let max = pop_max.unwrap_or(15);

    // Seed population on selected tiles (deterministic subset using seed)
    let mut total_population: u32 = 0;
    let mut indices: Vec<usize> = (0..habitable_tile_ids.len()).collect();

    // Fisher-Yates shuffle using seed for determinism
    let mut hash_seed = seed as u64;
    for i in (1..indices.len()).rev() {
        hash_seed = hash_seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = (hash_seed >> 33) as usize % (i + 1);
        indices.swap(i, j);
    }

    for &idx in indices.iter().take(tiles_to_seed) {
        let tile_id = habitable_tile_ids[idx];
        let count = w.seed_population_on_tile_range(min, max, tile_id as u16);
        total_population += count as u32;
    }

    Ok(RestartResult {
        seed,
        population: total_population,
        tiles: tiles_to_seed as u32,
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
