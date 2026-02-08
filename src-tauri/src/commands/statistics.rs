use tauri::State;

use simulation::components::EventType;
use simulation::world::VitalStatistics;

use crate::state::{AppState, EventData};

#[tauri::command]
pub fn get_vital_statistics(
    state: State<AppState>,
    start_year: i32,
    end_year: i32,
) -> VitalStatistics {
    state
        .world
        .lock()
        .unwrap()
        .calculate_vital_statistics(start_year as u16, end_year as u16)
}

#[tauri::command]
pub fn get_current_year_statistics(state: State<AppState>) -> VitalStatistics {
    state
        .world
        .lock()
        .unwrap()
        .calculate_current_year_statistics()
}

#[tauri::command]
pub fn get_recent_statistics(state: State<AppState>, years: Option<u32>) -> VitalStatistics {
    state
        .world
        .lock()
        .unwrap()
        .calculate_recent_statistics(years.unwrap_or(10) as u16)
}

#[tauri::command]
pub fn get_recent_events(state: State<AppState>, count: Option<u32>) -> Vec<EventData> {
    let w = state.world.lock().unwrap();
    w.event_log
        .get_recent(count.unwrap_or(100) as usize)
        .into_iter()
        .map(event_to_data)
        .collect()
}

#[tauri::command]
pub fn get_event_count(state: State<AppState>) -> u32 {
    state.world.lock().unwrap().event_log.len() as u32
}

fn event_to_data(event: simulation::components::Event) -> EventData {
    let event_type = match event.event_type {
        EventType::Birth => "birth",
        EventType::Death => "death",
        EventType::Marriage => "marriage",
        EventType::PregnancyStarted => "pregnancy_started",
        EventType::Dissolution => "dissolution",
    }
    .to_string();

    EventData {
        event_type,
        year: event.year as i32,
        month: event.month,
        day: event.day,
        person_id: event.person_id.map(|id| id as i64),
    }
}
