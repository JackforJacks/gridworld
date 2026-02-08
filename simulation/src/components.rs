//! ECS Components for GridWorld entities
//!
//! Add components here as you design the simulation.

use serde::{Deserialize, Serialize};

// ============================================================================
// Identity Components
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PersonId(pub u64);

/// Tile residency - which tile this person lives on
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TileId(pub u16);

// ============================================================================
// Person Components
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: PersonId,
    pub first_name: String,
    pub last_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Sex {
    Male,
    Female,
}

/// Birth date using calendar year/month/day
/// 4 bytes total (u16 + u8 + u8)
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BirthDate {
    pub year: u16,   // 0-65535 (plenty for year 4000+)
    pub month: u8,   // 1-12
    pub day: u8,     // 1-8 (custom calendar)
}

impl BirthDate {
    /// Create from calendar
    pub fn new(year: u16, month: u8, day: u8) -> Self {
        Self { year, month, day }
    }
    
    /// Create from age in years (for seeding)
    pub fn from_age(age_years: u16, cal: &Calendar) -> Self {
        Self {
            year: cal.year.saturating_sub(age_years),
            month: cal.month,
            day: cal.day,
        }
    }
    
    /// Get age in years (approximate - ignores month/day)
    pub fn age_years(&self, cal: &Calendar) -> u16 {
        cal.year.saturating_sub(self.year)
    }
    
    /// Get age in months (more precise)
    pub fn age_months(&self, cal: &Calendar) -> u32 {
        let years = cal.year.saturating_sub(self.year) as u32;
        let months = cal.month as i32 - self.month as i32;
        (years * 12).saturating_add_signed(months)
    }
    
    /// Check if person can have children based on sex and age
    pub fn can_have_children(&self, sex: Sex, cal: &Calendar) -> bool {
        let years = self.age_years(cal);
        match sex {
            Sex::Female => (16..=33).contains(&years),
            Sex::Male => (16..=65).contains(&years),
        }
    }
}

// ============================================================================
// Relationship Components (simple model)
// ============================================================================

/// Partner/spouse - presence means married, absence means single
#[derive(Debug, Clone, Copy)]
pub struct Partner(pub hecs::Entity);

/// Biological mother - tracks maternal lineage
#[derive(Debug, Clone, Copy)]
pub struct Mother(pub hecs::Entity);

/// Pregnancy tracking - added when a woman becomes pregnant
/// Gestation period: ~9 months (72 days in our calendar)
#[derive(Debug, Clone, Copy)]
pub struct Pregnant {
    pub due_year: u16,
    pub due_month: u8,
}

impl Pregnant {
    /// Create a new pregnancy with due date ~9 months from now
    pub fn new(cal: &Calendar) -> Self {
        let mut due_month = cal.month + 9;
        let mut due_year = cal.year;
        if due_month > 12 {
            due_month -= 12;
            due_year += 1;
        }
        Self { due_year, due_month }
    }
    
    /// Check if the baby is due (current date >= due date)
    pub fn is_due(&self, cal: &Calendar) -> bool {
        if cal.year > self.due_year {
            return true;
        }
        if cal.year == self.due_year && cal.month >= self.due_month {
            return true;
        }
        false
    }
}

/// Fertility tracking for women
/// Uses year/month for birth interval tracking (0 = never gave birth)
#[derive(Debug, Clone, Copy, Default)]
pub struct Fertility {
    pub last_birth_year: u16,   // 0 = never
    pub last_birth_month: u8,   // 1-12
    pub children_born: u8,      // Total children (max 255)
}

impl Fertility {
    /// Check if enough time has passed since last birth (18 months / 1.5 years minimum)
    pub fn can_give_birth(&self, cal: &Calendar) -> bool {
        if self.last_birth_year == 0 {
            return true;  // Never gave birth
        }
        let months_since = (cal.year as i32 - self.last_birth_year as i32) * 12
            + (cal.month as i32 - self.last_birth_month as i32);
        months_since >= 18
    }
    
    /// Get fertility reduction factor based on number of children
    /// -10% per child, minimum 20% fertility
    pub fn children_factor(&self) -> f64 {
        (1.0 - self.children_born as f64 * 0.1).max(0.2)
    }
    
    /// Record a birth
    pub fn record_birth(&mut self, cal: &Calendar) {
        self.last_birth_year = cal.year;
        self.last_birth_month = cal.month;
        self.children_born = self.children_born.saturating_add(1);
    }
}



// ============================================================================
// Calendar
// ============================================================================

/// Custom calendar: 8 days/month, 12 months/year
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Calendar {
    pub year: u16,   // 0-65535
    pub month: u8,   // 1-12
    pub day: u8,     // 1-8
}

impl Default for Calendar {
    fn default() -> Self {
        Self { year: 4000, month: 1, day: 1 }
    }
}

impl Calendar {
    pub const DAYS_PER_MONTH: u8 = 8;
    pub const MONTHS_PER_YEAR: u8 = 12;
    pub const DAYS_PER_YEAR: u16 = 96;  // 8 * 12
    
    pub fn new(year: u16, month: u8, day: u8) -> Self {
        Self { year, month, day }
    }
    
    /// Advance by one day
    pub fn advance(&mut self) {
        self.day += 1;
        if self.day > Self::DAYS_PER_MONTH {
            self.day = 1;
            self.month += 1;
            if self.month > Self::MONTHS_PER_YEAR {
                self.month = 1;
                self.year += 1;
            }
        }
    }
}

// ============================================================================
// Event Log (Phase 2 - moved from Node.js)
// ============================================================================

use std::collections::VecDeque;

/// Event types for tracking simulation history
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    Birth,
    Death,
    Marriage,
    PregnancyStarted,
    Dissolution,
}

/// A single event in the simulation history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: EventType,
    pub year: u16,
    pub month: u8,
    pub day: u8,
    /// Optional person ID (for births, deaths)
    pub person_id: Option<u64>,
}

impl Event {
    pub fn new(event_type: EventType, calendar: &Calendar) -> Self {
        Self {
            event_type,
            year: calendar.year,
            month: calendar.month,
            day: calendar.day,
            person_id: None,
        }
    }

    pub fn with_person(event_type: EventType, calendar: &Calendar, person_id: u64) -> Self {
        Self {
            event_type,
            year: calendar.year,
            month: calendar.month,
            day: calendar.day,
            person_id: Some(person_id),
        }
    }
}

/// Event log with circular buffer (configurable max size)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLog {
    events: VecDeque<Event>,
    max_size: usize,
}

impl EventLog {
    pub fn new(max_size: usize) -> Self {
        Self {
            events: VecDeque::with_capacity(max_size),
            max_size,
        }
    }

    /// Add an event to the log
    pub fn push(&mut self, event: Event) {
        if self.events.len() >= self.max_size {
            self.events.pop_front(); // Remove oldest
        }
        self.events.push_back(event);
    }

    /// Iterate all events (newest first), zero allocation
    pub fn iter_all(&self) -> impl Iterator<Item = &Event> + '_ {
        self.events.iter().rev()
    }

    /// Get all events (newest first)
    pub fn get_all(&self) -> Vec<Event> {
        self.iter_all().cloned().collect()
    }

    /// Iterate events by type (newest first), zero allocation
    pub fn iter_by_type(&self, event_type: EventType) -> impl Iterator<Item = &Event> + '_ {
        self.events.iter().filter(move |e| e.event_type == event_type).rev()
    }

    /// Get events filtered by type
    pub fn get_by_type(&self, event_type: EventType) -> Vec<Event> {
        self.iter_by_type(event_type).cloned().collect()
    }

    /// Iterate events within a date range (newest first), zero allocation
    pub fn iter_by_date_range(&self, start_year: u16, end_year: u16) -> impl Iterator<Item = &Event> + '_ {
        self.events.iter().filter(move |e| e.year >= start_year && e.year <= end_year).rev()
    }

    /// Get events within a date range (inclusive)
    pub fn get_by_date_range(&self, start_year: u16, end_year: u16) -> Vec<Event> {
        self.iter_by_date_range(start_year, end_year).cloned().collect()
    }

    /// Get recent events (last N events)
    pub fn get_recent(&self, count: usize) -> Vec<Event> {
        self.events
            .iter()
            .rev()
            .take(count)
            .cloned()
            .collect()
    }

    /// Count events by type within a date range
    pub fn count_by_type(&self, event_type: EventType, start_year: u16, end_year: u16) -> usize {
        self.events
            .iter()
            .filter(|e| {
                e.event_type == event_type && e.year >= start_year && e.year <= end_year
            })
            .count()
    }

    /// Clear all events
    pub fn clear(&mut self) {
        self.events.clear();
    }

    /// Get total event count
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Check if log is empty
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

impl Default for EventLog {
    fn default() -> Self {
        Self::new(10000) // Default to 10k events (~10k ticks of history)
    }
}
