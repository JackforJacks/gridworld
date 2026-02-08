//! Death System
//! 
//! Determines mortality based on age and despawns dead entities.

use hecs::World;
use rand::Rng;
use crate::components::{BirthDate, Calendar};

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

/// Get daily mortality rate for a given age
fn get_mortality_rate(years: u16) -> f64 {
    let annual = MORTALITY_RATES
        .iter()
        .rev()
        .find(|(age, _)| years >= *age as u16)
        .map(|(_, rate)| *rate)
        .unwrap_or(0.002);
    
    // Convert annual to daily: 1 - (1 - annual)^(1/96) for 96 days/year
    1.0 - (1.0 - annual).powf(1.0 / Calendar::DAYS_PER_YEAR as f64)
}

/// Process death for all entities - despawns dead ones immediately.
/// Returns the number of deaths this tick.
pub fn death_system(world: &mut World, cal: &Calendar) -> u32 {
    let mut rng = rand::thread_rng();
    let mut deaths = Vec::new();
    
    // Determine who dies this tick
    for (entity, birth) in world.query::<&BirthDate>().iter() {
        let years = birth.age_years(cal);
        let rate = get_mortality_rate(years);
        if rng.gen::<f64>() < rate {
            deaths.push(entity);
        }
    }
    
    let count = deaths.len() as u32;
    
    // Despawn dead entities
    for entity in deaths {
        let _ = world.despawn(entity); // Entity guaranteed to exist from query above
    }
    
    count
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
