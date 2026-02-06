//! Birth System
//! 
//! Handles childbirth for partnered women.

use hecs::World;
use rand::Rng;
use crate::components::{
    BirthDate, Calendar, Fertility, Mother, Partner, Person, PersonId, Sex, TileId
};

/// Base fertility rate per day for eligible women
/// Annual ~0.48 / 96 days = 0.005 per day
const BASE_FERTILITY_RATE: f64 = 0.005;

/// Process births for all fertile partnered women
pub fn birth_system(world: &mut World, cal: &Calendar, next_person_id: &mut u64) {
    let mut rng = rand::thread_rng();
    let mut births: Vec<(hecs::Entity, TileId)> = Vec::new();
    
    // Find fertile women with partners
    for (entity, (birth, fertility, tile)) in world
        .query::<(&BirthDate, &Fertility, &TileId)>()
        .with::<&Partner>()
        .iter()
    {
        // Check if woman is in fertile age range
        if !birth.can_have_children(Sex::Female, cal) {
            continue;
        }
        
        // Check birth interval (18 months minimum)
        if !fertility.can_give_birth(cal) {
            continue;
        }
        
        // Fertility decreases with age (starts declining at 28, max age 33)
        let years = birth.age_years(cal);
        let age_factor = if years > 28 {
            1.0 - ((years - 28) as f64 * 0.1)  // -10% per year after 28
        } else {
            1.0
        };
        
        // Fertility decreases with number of children (-10% per child, min 20%)
        let children_factor = fertility.children_factor();
        
        let rate = BASE_FERTILITY_RATE * age_factor * children_factor;
        
        if rng.gen::<f64>() < rate {
            births.push((entity, *tile));
        }
    }
    
    // Process births
    for (mother_entity, tile_id) in births {
        // Update mother's fertility
        if let Ok(mut fertility) = world.get::<&mut Fertility>(mother_entity) {
            fertility.record_birth(cal);
        }
        
        // Create child entity
        let child_id = PersonId(*next_person_id);
        *next_person_id += 1;
        
        let sex = if rng.gen::<bool>() { Sex::Male } else { Sex::Female };
        
        let child = world.spawn((
            Person {
                id: child_id,
                first_name: format!("Child_{}", child_id.0),
                last_name: String::new(),
            },
            sex,
            BirthDate::new(cal.year, cal.month, cal.day),
            Mother(mother_entity),
            tile_id,  // Inherit mother's tile
        ));
        
        // Add fertility component if female
        if sex == Sex::Female {
            let _ = world.insert_one(child, Fertility::default());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fertility_age_check() {
        let cal = Calendar::default();
        let birth = BirthDate::from_age(25, &cal);
        assert!(birth.can_have_children(Sex::Female, &cal));
        
        let old_birth = BirthDate::from_age(50, &cal);
        assert!(!old_birth.can_have_children(Sex::Female, &cal));
    }
}
