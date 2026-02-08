//! Simulation World - main orchestrator

use hecs::World;
use rand::Rng;
use std::collections::HashMap;
use crate::components::*;
use crate::systems;

/// Result of a single simulation tick
pub struct TickResult {
    pub births: u32,
    pub deaths: u32,
    pub marriages: u32,
    pub pregnancies: u32,
    pub dissolutions: u32,
    pub population: u32,
}

pub struct SimulationWorld {
    pub world: World,
    pub calendar: Calendar,
    pub next_person_id: u64,
    pub event_log: EventLog,
}

impl SimulationWorld {
    pub fn new() -> Self {
        Self {
            world: World::new(),
            calendar: Calendar::default(),  // Year 4000, month 1, day 1
            next_person_id: 1,
            event_log: EventLog::default(), // 10k event capacity
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

    /// Seed population on a tile with a random count within [min, max].
    /// Returns the actual count seeded.
    pub fn seed_population_on_tile_range(&mut self, min: usize, max: usize, tile_id: u16) -> usize {
        let mut rng = rand::thread_rng();
        let count = rng.gen_range(min..=max);
        self.seed_population_on_tile(count, tile_id);
        count
    }

    /// Run one simulation tick (advances 1 day).
    /// Returns a TickResult with births, deaths, marriages, pregnancies, dissolutions, and population.
    pub fn tick(&mut self) -> TickResult {
        self.calendar.advance();

        // Run all systems
        let deaths = systems::death_system(&mut self.world, &self.calendar);
        let marriages = systems::matchmaking_system(&mut self.world, &self.calendar);
        let family = systems::family_system(&mut self.world, &self.calendar, &mut self.next_person_id);
        let population = self.entity_count() as u32;

        // Log events to event log (Phase 2)
        for _ in 0..family.deliveries {
            self.event_log.push(Event::new(EventType::Birth, &self.calendar));
        }
        for _ in 0..deaths {
            self.event_log.push(Event::new(EventType::Death, &self.calendar));
        }
        for _ in 0..marriages {
            self.event_log.push(Event::new(EventType::Marriage, &self.calendar));
        }
        for _ in 0..family.new_pregnancies {
            self.event_log.push(Event::new(EventType::PregnancyStarted, &self.calendar));
        }
        for _ in 0..family.dissolutions {
            self.event_log.push(Event::new(EventType::Dissolution, &self.calendar));
        }

        TickResult {
            births: family.deliveries,
            deaths,
            marriages,
            pregnancies: family.new_pregnancies,
            dissolutions: family.dissolutions,
            population,
        }
    }

    /// Get entity count (all entities with BirthDate component = people)
    pub fn entity_count(&self) -> usize {
        self.world.query::<&BirthDate>().iter().count()
    }
    
    /// Get current calendar year
    pub fn current_year(&self) -> u16 {
        self.calendar.year
    }

    // ========================================================================
    // Statistics queries (Phase 2)
    // ========================================================================

    /// Population count for a specific tile
    pub fn tile_population(&self, tile_id: u16) -> u32 {
        self.world.query::<&TileId>()
            .iter()
            .filter(|(_, t)| t.0 == tile_id)
            .count() as u32
    }

    /// Population count per tile
    pub fn population_by_tile(&self) -> HashMap<u16, u32> {
        let mut map: HashMap<u16, u32> = HashMap::new();
        for (_, tile) in self.world.query::<&TileId>().iter() {
            *map.entry(tile.0).or_insert(0) += 1;
        }
        map
    }

    /// Full demographics snapshot in a single pass
    pub fn demographics(&self) -> Demographics {
        let mut males: u32 = 0;
        let mut females: u32 = 0;
        let mut partnered: u32 = 0;
        let mut single: u32 = 0;
        let mut pregnant: u32 = 0;
        let mut age_brackets = [0u32; 7]; // 0-4, 5-14, 15-29, 30-49, 50-69, 70-89, 90+
        let mut total_age: u64 = 0;
        let mut count: u32 = 0;

        for (entity, (birth, sex)) in self.world.query::<(&BirthDate, &Sex)>().iter() {
            count += 1;
            let years = birth.age_years(&self.calendar);
            total_age += years as u64;

            match sex {
                Sex::Male => males += 1,
                Sex::Female => females += 1,
            }

            // Age bracket
            let bracket = match years {
                0..=4 => 0,
                5..=14 => 1,
                15..=29 => 2,
                30..=49 => 3,
                50..=69 => 4,
                70..=89 => 5,
                _ => 6,
            };
            age_brackets[bracket] += 1;

            // Partnership
            if self.world.get::<&Partner>(entity).is_ok() {
                partnered += 1;
            } else {
                single += 1;
            }
            
            // Pregnancy
            if self.world.get::<&Pregnant>(entity).is_ok() {
                pregnant += 1;
            }
        }

        let average_age = if count > 0 { total_age as f64 / count as f64 } else { 0.0 };

        Demographics {
            population: count,
            males,
            females,
            partnered,
            single,
            pregnant,
            average_age,
            age_brackets,
        }
    }
}

/// Full demographics snapshot
pub struct Demographics {
    pub population: u32,
    pub males: u32,
    pub females: u32,
    pub partnered: u32,
    pub single: u32,
    pub pregnant: u32,
    pub average_age: f64,
    /// [0-4, 5-14, 15-29, 30-49, 50-69, 70-89, 90+]
    pub age_brackets: [u32; 7],
}

/// Vital statistics (Phase 3) - calculated from event log
pub struct VitalStatistics {
    /// Births per 1000 population per year
    pub birth_rate: f64,
    /// Deaths per 1000 population per year
    pub death_rate: f64,
    /// Marriages per 1000 population per year
    pub marriage_rate: f64,
    /// Natural increase rate (births - deaths) per 1000 population per year
    pub natural_increase_rate: f64,
    /// Total births in period
    pub total_births: u32,
    /// Total deaths in period
    pub total_deaths: u32,
    /// Total marriages in period
    pub total_marriages: u32,
    /// Population (average over period)
    pub population: u32,
    /// Period length in years
    pub period_years: f64,
}

impl SimulationWorld {
    /// Calculate vital statistics from event log for a date range
    ///
    /// # Arguments
    /// * `start_year` - Start year (inclusive)
    /// * `end_year` - End year (inclusive)
    ///
    /// # Returns
    /// VitalStatistics for the specified period
    pub fn calculate_vital_statistics(&self, start_year: u16, end_year: u16) -> VitalStatistics {
        use crate::components::EventType;

        let births = self.event_log.count_by_type(EventType::Birth, start_year, end_year) as u32;
        let deaths = self.event_log.count_by_type(EventType::Death, start_year, end_year) as u32;
        let marriages = self.event_log.count_by_type(EventType::Marriage, start_year, end_year) as u32;

        let population = self.entity_count() as u32;
        let period_years = (end_year.saturating_sub(start_year) + 1) as f64;

        // Calculate rates per 1000 population per year
        let pop_factor = if population > 0 { 1000.0 / (population as f64 * period_years) } else { 0.0 };

        let birth_rate = births as f64 * pop_factor * period_years;
        let death_rate = deaths as f64 * pop_factor * period_years;
        let marriage_rate = marriages as f64 * pop_factor * period_years;
        let natural_increase_rate = birth_rate - death_rate;

        VitalStatistics {
            birth_rate,
            death_rate,
            marriage_rate,
            natural_increase_rate,
            total_births: births,
            total_deaths: deaths,
            total_marriages: marriages,
            population,
            period_years,
        }
    }

    /// Calculate vital statistics for the current year only
    pub fn calculate_current_year_statistics(&self) -> VitalStatistics {
        let year = self.calendar.year;
        self.calculate_vital_statistics(year, year)
    }

    /// Calculate vital statistics for the last N years
    pub fn calculate_recent_statistics(&self, years: u16) -> VitalStatistics {
        let end_year = self.calendar.year;
        let start_year = end_year.saturating_sub(years.saturating_sub(1));
        self.calculate_vital_statistics(start_year, end_year)
    }
}

impl Default for SimulationWorld {
    fn default() -> Self {
        Self::new()
    }
}
