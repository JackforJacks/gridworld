use tauri::State;

use simulation::world::Demographics;

use crate::state::{AppState, TilePopulationData};

#[tauri::command]
pub fn get_population(state: State<AppState>) -> u32 {
    state.world.lock().unwrap().entity_count() as u32
}

#[tauri::command]
pub fn get_demographics(state: State<AppState>) -> Demographics {
    state.world.lock().unwrap().demographics()
}

#[tauri::command]
pub fn get_population_by_tile(state: State<AppState>) -> Vec<TilePopulationData> {
    let w = state.world.lock().unwrap();
    let map = w.population_by_tile();
    let mut result: Vec<TilePopulationData> = map
        .into_iter()
        .map(|(tile_id, count)| TilePopulationData {
            tile_id: tile_id as u32,
            count,
        })
        .collect();
    result.sort_by_key(|t| t.tile_id);
    result
}

#[tauri::command]
pub fn get_tile_population(state: State<AppState>, tile_id: u32) -> u32 {
    state
        .world
        .lock()
        .unwrap()
        .tile_population(tile_id as u16)
}
