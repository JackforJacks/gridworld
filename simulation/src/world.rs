//! Simulation World - main orchestrator

use hecs::World;
use rand::Rng;
use crate::components::*;
use crate::systems;

pub struct SimulationWorld {
    pub world: World,
    pub current_tick: u64,
    pub calendar: Calendar,
    pub next_person_id: u64,
}

impl SimulationWorld {
    pub fn new() -> Self {
        Self {
            world: World::new(),
            current_tick: 0,
            calendar: Calendar::default(),
            next_person_id: 1,
        }
    }

    /// Seed initial population
    pub fn seed_population(&mut self, count: usize) {
        let mut rng = rand::thread_rng();
        
        for _ in 0..count {
            let id = PersonId(self.next_person_id);
            self.next_person_id += 1;
            
            let sex = if rng.gen::<bool>() { Sex::Male } else { Sex::Female };
            let age = Age::new(rng.gen_range(0..60));
            
            self.world.spawn((
                Person {
                    id,
                    first_name: format!("Person_{}", id.0),
                    last_name: String::new(),
                },
                sex,
                age,
                Alive,
            ));
        }
    }

    /// Run one simulation tick
    pub fn tick(&mut self) {
        self.current_tick += 1;
        self.calendar.advance();
        
        // Run systems
        systems::aging_system(&mut self.world);
        
        // TODO: Add more systems here
    }

    /// Get living entity count
    pub fn entity_count(&self) -> usize {
        self.world.query::<()>().with::<&Alive>().iter().count()
    }
}

impl Default for SimulationWorld {
    fn default() -> Self {
        Self::new()
    }
}
