//! GridWorld Simulation Benchmark
//! 
//! Standalone benchmark for the simulation engine.

mod components;
mod systems;
mod world;
mod storage;

use world::SimulationWorld;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

fn main() -> anyhow::Result<()> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    info!("GridWorld Simulation Engine starting...");

    // Create simulation world
    let mut world = SimulationWorld::new();
    
    // Seed initial population for testing
    let initial_pop = 100_000;
    info!("Seeding {} initial population...", initial_pop);
    world.seed_population(initial_pop);
    
    info!("Population seeded. Entity count: {}", world.entity_count());

    // Run simulation tick benchmark
    info!("Running 10 year benchmark (120 ticks)...");
    let start = std::time::Instant::now();
    for _ in 0..120 {
        world.tick();
    }
    let elapsed = start.elapsed();
    
    info!(
        "Benchmark complete: {:?} total, {:?} per tick, {} final population",
        elapsed,
        elapsed / 120,
        world.entity_count()
    );

    Ok(())
}
