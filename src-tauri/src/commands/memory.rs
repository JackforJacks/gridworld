use serde::Serialize;

#[derive(Serialize)]
pub struct MemoryUsage {
    pub physical_mem: u64,
}

#[tauri::command]
pub fn get_memory_usage() -> MemoryUsage {
    let physical = memory_stats::memory_stats()
        .map(|stats| stats.physical_mem as u64)
        .unwrap_or(0);

    MemoryUsage {
        physical_mem: physical,
    }
}

#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}
