//! Family System
//! 
//! Handles pregnancy, delivery, and family dissolution.

use hecs::World;
use rand::Rng;
use crate::components::{
    BirthDate, Calendar, Fertility, Mother, Partner, Person, PersonId, Pregnant, Sex, TileId
};

/// Base conception rate per day for eligible partnered women
/// Annual ~0.40 / 96 days ≈ 0.004 per day (slightly lower than instant birth)
const BASE_CONCEPTION_RATE: f64 = 0.004;

/// Result of running family systems
pub struct FamilyResult {
    pub new_pregnancies: u32,
    pub deliveries: u32,
    pub dissolutions: u32,
}

/// Run all family systems in order.
/// Returns counts of pregnancies, deliveries, and dissolutions.
pub fn family_system(world: &mut World, cal: &Calendar, next_person_id: &mut u64) -> FamilyResult {
    let dissolutions = dissolution_system(world);
    let new_pregnancies = pregnancy_system(world, cal);
    let deliveries = delivery_system(world, cal, next_person_id);
    
    FamilyResult {
        new_pregnancies,
        deliveries,
        dissolutions,
    }
}

/// Initiate pregnancies for eligible partnered women.
/// Returns the number of new pregnancies.
fn pregnancy_system(world: &mut World, cal: &Calendar) -> u32 {
    let mut rng = rand::thread_rng();
    let mut to_conceive: Vec<hecs::Entity> = Vec::new();
    
    // Find eligible women: partnered, fertile age, not already pregnant, birth interval passed
    for (entity, (birth, fertility)) in world
        .query::<(&BirthDate, &Fertility)>()
        .with::<&Partner>()
        .without::<&Pregnant>()
        .iter()
    {
        // Must be in fertile age range (16-33 for women)
        if !birth.can_have_children(Sex::Female, cal) {
            continue;
        }
        
        // Check birth interval (18 months minimum since last birth)
        if !fertility.can_give_birth(cal) {
            continue;
        }
        
        // Age factor: fertility declines after 28
        let years = birth.age_years(cal);
        let age_factor = if years > 28 {
            (1.0 - ((years - 28) as f64 * 0.15)).max(0.1)  // -15% per year after 28
        } else {
            1.0
        };
        
        // Children factor: -10% per existing child, min 20%
        let children_factor = fertility.children_factor();
        
        let rate = BASE_CONCEPTION_RATE * age_factor * children_factor;
        
        if rng.gen::<f64>() < rate {
            to_conceive.push(entity);
        }
    }
    
    let count = to_conceive.len() as u32;
    
    // Add Pregnant component to each
    for entity in to_conceive {
        let _ = world.insert_one(entity, Pregnant::new(cal));
    }
    
    count
}

/// Process deliveries for pregnant women whose due date has arrived.
/// Returns the number of births.
fn delivery_system(world: &mut World, cal: &Calendar, next_person_id: &mut u64) -> u32 {
    let mut rng = rand::thread_rng();
    let mut deliveries: Vec<(hecs::Entity, TileId)> = Vec::new();
    
    // Find pregnant women whose due date has arrived
    for (entity, (pregnant, tile)) in world
        .query::<(&Pregnant, &TileId)>()
        .iter()
    {
        if pregnant.is_due(cal) {
            deliveries.push((entity, *tile));
        }
    }
    
    let count = deliveries.len() as u32;
    
    // Process each delivery
    for (mother_entity, tile_id) in deliveries {
        // Remove Pregnant component
        let _ = world.remove_one::<Pregnant>(mother_entity);
        
        // Update mother's fertility tracking
        if let Ok(mut fertility) = world.get::<&mut Fertility>(mother_entity) {
            fertility.record_birth(cal);
        }
        
        // Create child
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
        
        // Add fertility component if female child
        if sex == Sex::Female {
            let _ = world.insert_one(child, Fertility::default());
        }
    }
    
    count
}

/// Clean up Partner components when a spouse has died.
/// This runs after death_system to remove orphaned Partner references.
/// Returns the number of dissolutions (widowed people).
fn dissolution_system(world: &mut World) -> u32 {
    let mut to_remove_partner: Vec<hecs::Entity> = Vec::new();
    
    // Find people whose partner no longer exists
    for (entity, partner) in world.query::<&Partner>().iter() {
        // Check if the partner entity still exists
        if !world.contains(partner.0) {
            to_remove_partner.push(entity);
        }
    }
    
    let count = to_remove_partner.len() as u32;
    
    // Remove Partner component from widowed people
    for entity in to_remove_partner {
        let _ = world.remove_one::<Partner>(entity);
    }
    
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pregnant_due_date() {
        let cal = Calendar { year: 4000, month: 6, day: 1 };
        let pregnant = Pregnant::new(&cal);
        
        // Due in month 3 of next year (6 + 9 = 15, wrap to 3)
        assert_eq!(pregnant.due_year, 4001);
        assert_eq!(pregnant.due_month, 3);
        
        // Not due yet
        let cal_before = Calendar { year: 4001, month: 2, day: 8 };
        assert!(!pregnant.is_due(&cal_before));
        
        // Due now
        let cal_due = Calendar { year: 4001, month: 3, day: 1 };
        assert!(pregnant.is_due(&cal_due));
    }
}
