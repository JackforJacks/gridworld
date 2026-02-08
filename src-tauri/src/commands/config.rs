use tauri::State;

use crate::state::{AppConfig, AppState, CalendarConfig, HexasphereConfig};

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    let seed = *state.seed.lock().unwrap();
    AppConfig {
        hexasphere: HexasphereConfig {
            radius: 50.0,
            subdivisions: 12,
            tile_width_ratio: 1.0,
        },
        calendar: CalendarConfig {
            days_per_month: 8,
            months_per_year: 12,
            start_year: 4000,
        },
        seed,
    }
}
