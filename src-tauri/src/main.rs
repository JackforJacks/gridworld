// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;
use std::sync::{Arc, Mutex};

fn main() {
    let world = Arc::new(Mutex::new(simulation::world::SimulationWorld::new()));

    let app_state = AppState {
        world,
        calendar_runner: Mutex::new(None),
        seed: Mutex::new(12345),
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Config
            commands::config::get_config,
            // Calendar
            commands::calendar::get_calendar_state,
            commands::calendar::get_calendar_speeds,
            commands::calendar::start_calendar,
            commands::calendar::stop_calendar,
            commands::calendar::set_calendar_speed,
            // World
            commands::world::tick,
            commands::world::save_world,
            commands::world::load_world,
            commands::world::restart_world,
            // Population
            commands::population::get_population,
            commands::population::get_demographics,
            commands::population::get_population_by_tile,
            commands::population::get_tile_population,
            // People
            commands::people::get_all_people,
            commands::people::get_person,
            commands::people::get_people_by_tile,
            // Statistics
            commands::statistics::get_vital_statistics,
            commands::statistics::get_current_year_statistics,
            commands::statistics::get_recent_statistics,
            commands::statistics::get_recent_events,
            commands::statistics::get_event_count,
            // Tiles
            commands::tiles::calculate_tile_properties,
            // Memory & App
            commands::memory::get_memory_usage,
            commands::memory::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
