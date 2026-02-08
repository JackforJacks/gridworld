//! Calendar Runner - Background thread that ticks the simulation at regular intervals

use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use crate::world::{SimulationWorld, TickResult};

/// Calendar runner that manages a background thread for automatic ticking
pub struct CalendarRunner {
    is_running: Arc<AtomicBool>,
    thread_handle: Option<JoinHandle<()>>,
}

impl CalendarRunner {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
        }
    }

    /// Start the calendar ticking at the specified interval
    ///
    /// # Arguments
    /// * `world` - Shared reference to the simulation world
    /// * `interval_ms` - Milliseconds between ticks (e.g., 1000 for daily speed, 125 for monthly)
    /// * `callback` - Function to call with tick results (for broadcasting to Node.js)
    pub fn start<F>(
        &mut self,
        world: Arc<Mutex<SimulationWorld>>,
        interval_ms: u64,
        callback: F,
    ) where
        F: Fn(TickResult) + Send + 'static,
    {
        // Don't start if already running
        if self.is_running.load(Ordering::Relaxed) {
            eprintln!("[WARN] Calendar runner already running");
            return;
        }

        println!("[INFO] Starting Rust calendar runner ({}ms intervals)", interval_ms);
        self.is_running.store(true, Ordering::Relaxed);
        let running = Arc::clone(&self.is_running);

        let handle = thread::spawn(move || {
            while running.load(Ordering::Relaxed) {
                // Execute tick
                let tick_result = {
                    let mut w = world.lock().unwrap();
                    w.tick()
                };

                // Call the callback with results
                callback(tick_result);

                // Sleep until next tick
                thread::sleep(Duration::from_millis(interval_ms));
            }
            println!("[INFO] Calendar runner thread stopped");
        });

        self.thread_handle = Some(handle);
    }

    /// Stop the calendar ticking
    pub fn stop(&mut self) {
        if !self.is_running.load(Ordering::Relaxed) {
            return;
        }

        println!("[INFO] Stopping Rust calendar runner...");
        self.is_running.store(false, Ordering::Relaxed);

        // Wait for thread to finish
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join(); // Thread panic result intentionally ignored during shutdown
        }
    }

    /// Check if the calendar is currently running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }
}

impl Drop for CalendarRunner {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    #[test]
    fn test_calendar_runner() {
        let world = Arc::new(Mutex::new(SimulationWorld::new()));
        world.lock().unwrap().seed_population(10);

        let tick_count = Arc::new(AtomicU32::new(0));
        let tick_count_clone = Arc::clone(&tick_count);

        let mut runner = CalendarRunner::new();
        runner.start(
            Arc::clone(&world),
            100, // 100ms between ticks
            move |_result| {
                tick_count_clone.fetch_add(1, Ordering::Relaxed);
            },
        );

        // Let it run for ~500ms (should get ~5 ticks)
        thread::sleep(Duration::from_millis(550));
        runner.stop();

        let count = tick_count.load(Ordering::Relaxed);
        assert!(count >= 4 && count <= 6, "Expected ~5 ticks, got {}", count);
    }
}
