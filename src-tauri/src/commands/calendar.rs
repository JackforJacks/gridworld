use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use simulation::calendar_runner::CalendarRunner;

use crate::state::{
    speed_interval, AppState, CalendarDate, CalendarState, SpeedMode, TickEvent,
};

#[tauri::command]
pub fn get_calendar_state(state: State<AppState>) -> CalendarState {
    let w = state.world.lock().unwrap();
    let runner = state.calendar_runner.lock().unwrap();
    let is_running = runner.as_ref().map(|r| r.is_running()).unwrap_or(false);

    CalendarState {
        date: CalendarDate {
            year: w.calendar.year as i32,
            month: w.calendar.month,
            day: w.calendar.day as u32,
        },
        is_paused: !is_running,
        current_speed: "1_day".into(),
    }
}

#[tauri::command]
pub fn get_calendar_speeds() -> Vec<SpeedMode> {
    crate::state::default_speeds()
}

#[tauri::command]
pub fn start_calendar(
    app: AppHandle,
    state: State<AppState>,
    speed: Option<String>,
) -> Result<CalendarState, String> {
    let speed_key = speed.unwrap_or_else(|| "1_day".into());
    let interval = speed_interval(&speed_key);

    let world_clone = Arc::clone(&state.world);
    let world_for_callback = Arc::clone(&state.world);

    let mut runner = CalendarRunner::new();
    runner.start(world_clone, interval, move |tick_result| {
        // Read calendar state after tick
        let (year, month, day) = {
            let w = world_for_callback.lock().unwrap();
            (w.calendar.year, w.calendar.month, w.calendar.day)
        };

        let event = TickEvent {
            births: tick_result.births,
            deaths: tick_result.deaths,
            marriages: tick_result.marriages,
            pregnancies: tick_result.pregnancies,
            dissolutions: tick_result.dissolutions,
            population: tick_result.population,
            year: year as i32,
            month,
            day: day as u32,
        };

        let _ = app.emit("calendar-tick", &event);
    });

    // Store the runner
    let mut global_runner = state.calendar_runner.lock().unwrap();
    *global_runner = Some(runner);

    // Return current state
    let w = state.world.lock().unwrap();
    Ok(CalendarState {
        date: CalendarDate {
            year: w.calendar.year as i32,
            month: w.calendar.month,
            day: w.calendar.day as u32,
        },
        is_paused: false,
        current_speed: speed_key,
    })
}

#[tauri::command]
pub fn stop_calendar(state: State<AppState>) -> Result<CalendarState, String> {
    let mut global_runner = state.calendar_runner.lock().unwrap();
    if let Some(mut runner) = global_runner.take() {
        runner.stop();
    }

    let w = state.world.lock().unwrap();
    Ok(CalendarState {
        date: CalendarDate {
            year: w.calendar.year as i32,
            month: w.calendar.month,
            day: w.calendar.day as u32,
        },
        is_paused: true,
        current_speed: "1_day".into(),
    })
}

#[tauri::command]
pub fn set_calendar_speed(
    app: AppHandle,
    state: State<AppState>,
    speed: String,
) -> Result<CalendarState, String> {
    // Stop current runner
    {
        let mut global_runner = state.calendar_runner.lock().unwrap();
        if let Some(mut runner) = global_runner.take() {
            runner.stop();
        }
    }

    // Restart with new speed
    start_calendar(app, state, Some(speed))
}
