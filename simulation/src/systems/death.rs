//! Death System
//! 
//! Determines mortality based on age and removes dead entities.

use hecs::World;
use rand::Rng;
use crate::components::{Age, Alive, Dead};

/// Base mortality rates by age bracket (annual probability)
const MORTALITY_RATES: &[(u32, f64)] = &[
    (0, 0.05),     // Infant mortality
    (5, 0.005),    // Child
    (15, 0.002),   // Teen
    (30, 0.003),   // Young adult
    (50, 0.01),    // Middle age
    (60, 0.025),   // Senior
    (70, 0.05),    // Elderly
    (80, 0.12),    // Very old
    (90, 0.25),    // Ancient
    (100, 0.5),    // Centenarian
];

/// Get monthly mortality rate for a given age
fn get_mortality_rate(years: u32) -> f64 {
    let annual = MORTALITY_RATES
        .iter()
        .rev()
        .find(|(age, _)| years >= *age)
        .map(|(_, rate)| *rate)
        .unwrap_or(0.002);
    
    // Convert annual to monthly: 1 - (1 - annual)^(1/12)
    1.0 - (1.0 - annual).powf(1.0 / 12.0)
}

/// Process death for all living entities
pub fn death_system(world: &mut World, current_tick: u64) {
    let mut rng = rand::thread_rng();
    let mut deaths = Vec::new();
    
    // Determine who dies this tick
    for (entity, age) in world.query::<&Age>().with::<&Alive>().iter() {
        let rate = get_mortality_rate(age.years());
        if rng.gen::<f64>() < rate {
            deaths.push(entity);
        }
    }
    
    // Process deaths - remove Alive, add Dead
    for entity in deaths {
        let _ = world.remove_one::<Alive>(entity);
        let _ = world.insert_one(entity, Dead { tick_of_death: current_tick });
    }
}

/// Clean up dead entities (call periodically, not every tick)
pub fn cleanup_dead(world: &mut World, ticks_to_keep: u64, current_tick: u64) {
    let mut to_despawn = Vec::new();
    
    for (entity, dead) in world.query::<&Dead>().iter() {
        if current_tick - dead.tick_of_death > ticks_to_keep {
            to_despawn.push(entity);
        }
    }
    
    for entity in to_despawn {
        let _ = world.despawn(entity);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mortality_rates() {
        // Very old should have high mortality
        assert!(get_mortality_rate(90) > get_mortality_rate(30));
        
        // Infant mortality should be notable
        assert!(get_mortality_rate(0) > get_mortality_rate(10));
    }
}
