//! GridWorld Simulation Engine
//!
//! High-performance population simulation using ECS architecture.
//! Designed for 10M+ entities with parallel system execution.

#[macro_use]
extern crate napi_derive;

pub mod components;
pub mod systems;
pub mod world;
pub mod storage;
pub mod persistence;
pub mod calendar_runner;
pub mod napi_bindings;

pub use components::*;
pub use world::SimulationWorld;
pub use persistence::{ExportData, ImportResult, SaveStats, LoadFileResult};
