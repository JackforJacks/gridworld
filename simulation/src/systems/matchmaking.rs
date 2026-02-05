//! Matchmaking System
//! 
//! Pairs single adults into marriages.

use hecs::World;
use rand::seq::SliceRandom;
use crate::components::{
    Age, Alive, Family, FamilyHeads, FamilyId, FamilyMember, FamilyRole,
    Fertility, Married, Residency, Sex, Single, VillageId
};
use std::collections::HashMap;

/// Minimum age for marriage
const MARRIAGE_AGE: u32 = 16;

/// Maximum age difference for marriage
const MAX_AGE_DIFF: u32 = 15;

/// Process matchmaking - pair eligible singles
pub fn matchmaking_system(world: &mut World, current_tick: u64, next_family_id: &mut u64) {
    let mut rng = rand::thread_rng();
    
    // Collect eligible singles by village
    let mut single_men: HashMap<Option<VillageId>, Vec<(hecs::Entity, u32)>> = HashMap::new();
    let mut single_women: HashMap<Option<VillageId>, Vec<(hecs::Entity, u32)>> = HashMap::new();
    
    for (entity, (age, sex, residency)) in world
        .query::<(&Age, &Sex, Option<&Residency>)>()
        .with::<&Alive>()
        .with::<&Single>()
        .iter()
    {
        if age.years() < MARRIAGE_AGE {
            continue;
        }
        
        let village = residency.map(|r| r.village_id);
        let entry = (entity, age.years());
        
        match sex {
            Sex::Male => single_men.entry(village).or_default().push(entry),
            Sex::Female => single_women.entry(village).or_default().push(entry),
        }
    }
    
    // Match within each village
    let mut marriages = Vec::new();
    
    for (village, mut men) in single_men {
        if let Some(women) = single_women.get_mut(&village) {
            men.shuffle(&mut rng);
            women.shuffle(&mut rng);
            
            for (man_entity, man_age) in men {
                // Find compatible woman
                let woman_pos = women.iter().position(|(_, woman_age)| {
                    let diff = (*woman_age as i32 - man_age as i32).unsigned_abs();
                    diff <= MAX_AGE_DIFF
                });
                
                if let Some(pos) = woman_pos {
                    let (woman_entity, _) = women.remove(pos);
                    marriages.push((man_entity, woman_entity, village));
                }
            }
        }
    }
    
    // Process marriages
    for (husband_entity, wife_entity, _village) in marriages {
        // Create new family
        let family_id = FamilyId(*next_family_id);
        *next_family_id += 1;
        
        let _family_entity = world.spawn((
            Family { id: family_id },
            FamilyHeads {
                husband: Some(husband_entity),
                wife: Some(wife_entity),
            },
        ));
        
        // Remove Single, add Married and FamilyMember to both
        let _ = world.remove_one::<Single>(husband_entity);
        let _ = world.remove_one::<Single>(wife_entity);
        
        let _ = world.insert(husband_entity, (
            Married {
                spouse_entity: wife_entity,
                marriage_tick: current_tick,
            },
            FamilyMember {
                family_id,
                role: FamilyRole::Husband,
            },
        ));
        
        let _ = world.insert(wife_entity, (
            Married {
                spouse_entity: husband_entity,
                marriage_tick: current_tick,
            },
            FamilyMember {
                family_id,
                role: FamilyRole::Wife,
            },
        ));
        
        // Ensure wife has fertility component
        if world.get::<&Fertility>(wife_entity).is_err() {
            let _ = world.insert_one(wife_entity, Fertility::default());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_marriage_age_diff() {
        // 25 and 30 should be compatible
        let diff = (30i32 - 25i32).unsigned_abs();
        assert!(diff <= MAX_AGE_DIFF);
        
        // 20 and 50 should not be compatible
        let diff = (50i32 - 20i32).unsigned_abs();
        assert!(diff > MAX_AGE_DIFF);
    }
}
