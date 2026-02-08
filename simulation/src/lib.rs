//! GridWorld Simulation Engine
//!
//! High-performance population simulation using ECS architecture.
//! Designed for 10M+ entities with parallel system execution.

pub mod components;
pub mod systems;
pub mod world;
pub mod persistence;
pub mod calendar_runner;
pub mod names;

pub use components::*;
pub use world::SimulationWorld;
pub use persistence::{ExportData, ImportResult, SaveStats, LoadFileResult};
