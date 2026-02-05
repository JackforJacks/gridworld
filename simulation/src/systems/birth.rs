//! Birth System
//! 
//! Handles pregnancy and childbirth for married couples.

use hecs::World;
use rand::Rng;
use crate::components::{
    Age, Alive, FamilyId, FamilyMember, FamilyRole, Fertility, 
    Married, Person, PersonId, Residency, Sex, Single
};

/// Minimum ticks between births (about 2 years)
const MIN_BIRTH_INTERVAL: u64 = 24;

/// Base fertility rate per month for eligible women
const BASE_FERTILITY_RATE: f64 = 0.04;

/// Process births for all fertile married women
pub fn birth_system(world: &mut World, current_tick: u64, next_person_id: &mut u64) {
    let mut rng = rand::thread_rng();
    let mut births: Vec<(hecs::Entity, FamilyId, Option<Residency>)> = Vec::new();
    
    // Find fertile married women
    for (entity, (age, fertility, family_member, residency)) in world
        .query::<(&Age, &Fertility, &FamilyMember, Option<&Residency>)>()
        .with::<&Alive>()
        .with::<&Married>()
        .iter()
    {
        // Check if woman is in fertile age range
        if !age.can_have_children(Sex::Female) {
            continue;
        }
        
        // Check birth interval
        if let Some(last_birth) = fertility.last_birth_tick {
            if current_tick - last_birth < MIN_BIRTH_INTERVAL {
                continue;
            }
        }
        
        // Fertility decreases with age and number of children
        let age_factor = if age.years() > 35 {
            1.0 - ((age.years() - 35) as f64 * 0.05)
        } else {
            1.0
        };
        let children_factor = (1.0 - fertility.children_born as f64 * 0.08).max(0.2);
        let rate = BASE_FERTILITY_RATE * age_factor * children_factor;
        
        if rng.gen::<f64>() < rate {
            births.push((entity, family_member.family_id, residency.copied()));
        }
    }
    
    // Process births
    for (mother_entity, family_id, residency) in births {
        // Update mother's fertility
        if let Ok(mut fertility) = world.get::<&mut Fertility>(mother_entity) {
            fertility.last_birth_tick = Some(current_tick);
            fertility.children_born += 1;
        }
        
        // Create child entity
        let child_id = PersonId(*next_person_id);
        *next_person_id += 1;
        
        let sex = if rng.gen::<bool>() { Sex::Male } else { Sex::Female };
        
        let child_components = (
            Person {
                id: child_id,
                first_name: format!("Child_{}", child_id.0),
                last_name: String::new(), // TODO: inherit from family
            },
            sex,
            Age::new(0),
            Alive,
            FamilyMember {
                family_id,
                role: FamilyRole::Child,
            },
            Single,
        );
        
        let child = world.spawn(child_components);
        
        // Add residency if mother has one
        if let Some(res) = residency {
            let _ = world.insert_one(child, res);
        }
        
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
        let age = Age::new(25);
        assert!(age.can_have_children(Sex::Female));
        
        let old_age = Age::new(50);
        assert!(!old_age.can_have_children(Sex::Female));
    }
}
