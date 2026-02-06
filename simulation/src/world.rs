//! Simulation World - main orchestrator

use hecs::World;
use rand::Rng;
use crate::components::*;
use crate::systems;

pub struct SimulationWorld {
    pub world: World,
    pub calendar: Calendar,
    pub next_person_id: u64,
}

impl SimulationWorld {
    pub fn new() -> Self {
        Self {
            world: World::new(),
            calendar: Calendar::default(),  // Year 4000, month 1, day 1
            next_person_id: 1,
        }
    }

    /// Seed initial population (no tile assignment)
    pub fn seed_population(&mut self, count: usize) {
        self.seed_population_on_tile(count, 0);
    }
    
    /// Seed population on a specific tile
    pub fn seed_population_on_tile(&mut self, count: usize, tile_id: u16) {
        let mut rng = rand::thread_rng();
        
        for _ in 0..count {
            let id = PersonId(self.next_person_id);
            self.next_person_id += 1;
            
            let sex = if rng.gen::<bool>() { Sex::Male } else { Sex::Female };
            let age_years: u16 = rng.gen_range(0..60);
            let birth_date = BirthDate::from_age(age_years, &self.calendar);
            
            self.world.spawn((
                Person {
                    id,
                    first_name: format!("Person_{}", id.0),
                    last_name: String::new(),
                },
                sex,
                birth_date,
                TileId(tile_id),
            ));
        }
    }

    /// Run one simulation tick (advances 1 day)
    pub fn tick(&mut self) {
        self.calendar.advance();
        
        // Run all systems
        systems::death_system(&mut self.world, &self.calendar);
        systems::matchmaking_system(&mut self.world, &self.calendar);
        systems::birth_system(&mut self.world, &self.calendar, &mut self.next_person_id);
    }

    /// Get entity count (all entities with BirthDate component = people)
    pub fn entity_count(&self) -> usize {
        self.world.query::<&BirthDate>().iter().count()
    }
    
    /// Get current calendar year
    pub fn current_year(&self) -> u16 {
        self.calendar.year
    }
}

impl Default for SimulationWorld {
    fn default() -> Self {
        Self::new()
    }
}
