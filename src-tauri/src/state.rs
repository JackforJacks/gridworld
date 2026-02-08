use serde::Serialize;
use simulation::calendar_runner::CalendarRunner;
use simulation::world::SimulationWorld;
use std::sync::{Arc, Mutex};

/// Global application state managed by Tauri
pub struct AppState {
    pub world: Arc<Mutex<SimulationWorld>>,
    pub calendar_runner: Mutex<Option<CalendarRunner>>,
    pub seed: Mutex<u32>,
}

// -- Serializable types returned by commands --

#[derive(Serialize, Clone)]
pub struct HexasphereConfig {
    pub radius: f64,
    pub subdivisions: u32,
    pub tile_width_ratio: f64,
}

#[derive(Serialize, Clone)]
pub struct CalendarConfig {
    pub days_per_month: u8,
    pub months_per_year: u8,
    pub start_year: u16,
}

#[derive(Serialize, Clone)]
pub struct AppConfig {
    pub hexasphere: HexasphereConfig,
    pub calendar: CalendarConfig,
    pub seed: u32,
}

#[derive(Serialize, Clone)]
pub struct CalendarDate {
    pub year: i32,
    pub month: u8,
    pub day: u32,
}

#[derive(Serialize, Clone)]
pub struct CalendarState {
    pub date: CalendarDate,
    pub is_paused: bool,
    pub current_speed: String,
}

#[derive(Serialize, Clone)]
pub struct TickEvent {
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

#[derive(Serialize, Clone)]
pub struct SpeedMode {
    pub key: String,
    pub name: String,
    pub interval_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct PersonData {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub tile_id: i32,
    pub sex: bool,
    pub birth_year: i32,
    pub birth_month: i32,
    pub birth_day: i32,
    pub age_years: i32,
    pub is_partnered: bool,
    pub is_pregnant: bool,
    pub partner_id: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct EventData {
    pub event_type: String,
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub person_id: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct TilePopulationData {
    pub tile_id: u32,
    pub count: u32,
}

#[derive(Serialize, Clone)]
pub struct SaveResult {
    pub population: u32,
    pub file_bytes: i64,
}

#[derive(Serialize, Clone)]
pub struct LoadResult {
    pub population: u32,
    pub partners: u32,
    pub calendar_year: i32,
    pub seed: u32,
}

#[derive(Serialize, Clone)]
pub struct TileProperties {
    pub id: u32,
    pub terrain_type: String,
    pub biome: Option<String>,
    pub fertility: u32,
    pub is_habitable: bool,
}

/// Default speeds available for the calendar
pub fn default_speeds() -> Vec<SpeedMode> {
    vec![
        SpeedMode {
            key: "1_day".into(),
            name: "1 Day".into(),
            interval_ms: 1000,
        },
        SpeedMode {
            key: "1_month".into(),
            name: "1 Month".into(),
            interval_ms: 125,
        },
    ]
}

pub fn speed_interval(speed: &str) -> u64 {
    match speed {
        "1_month" => 125,
        _ => 1000, // default to 1_day
    }
}
