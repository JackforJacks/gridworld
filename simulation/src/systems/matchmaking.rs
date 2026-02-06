//! Matchmaking System
//! 
//! Pairs single adults into partnerships.

use hecs::World;
use rand::seq::SliceRandom;
use crate::components::{
    BirthDate, Calendar, Fertility, Partner, Sex, TileId
};
use std::collections::HashMap;

/// Minimum age for marriage
const MARRIAGE_AGE: u32 = 16;

/// Maximum age difference for marriage
const MAX_AGE_DIFF: u32 = 15;

/// Process matchmaking - pair eligible singles.
/// Returns the number of marriages formed this tick.
pub fn matchmaking_system(world: &mut World, cal: &Calendar) -> u32 {
    let mut rng = rand::thread_rng();
    
    // Collect eligible singles by tile (people without Partner)
    let mut single_men: HashMap<u16, Vec<(hecs::Entity, u16)>> = HashMap::new();
    let mut single_women: HashMap<u16, Vec<(hecs::Entity, u16)>> = HashMap::new();
    
    for (entity, (birth, sex, tile)) in world
        .query::<(&BirthDate, &Sex, &TileId)>()
        .without::<&Partner>()
        .iter()
    {
        let years = birth.age_years(cal);
        if years < MARRIAGE_AGE as u16 {
            continue;
        }
        
        let entry = (entity, years);
        
        match sex {
            Sex::Male => single_men.entry(tile.0).or_default().push(entry),
            Sex::Female => single_women.entry(tile.0).or_default().push(entry),
        }
    }
    
    // Match within each tile
    let mut marriages = Vec::new();
    
    for (tile, mut men) in single_men {
        if let Some(women) = single_women.get_mut(&tile) {
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
                    marriages.push((man_entity, woman_entity));
                }
            }
        }
    }
    
    let count = marriages.len() as u32;
    
    // Process marriages - just add Partner component to both
    for (husband_entity, wife_entity) in marriages {
        let _ = world.insert_one(husband_entity, Partner(wife_entity));
        let _ = world.insert_one(wife_entity, Partner(husband_entity));
        
        // Ensure wife has fertility component
        if world.get::<&Fertility>(wife_entity).is_err() {
            let _ = world.insert_one(wife_entity, Fertility::default());
        }
    }
    
    count
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
