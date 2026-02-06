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
            Sex::Female => years >= 16 && years <= 33,
            Sex::Male => years >= 16 && years <= 65,
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

/// Fertility tracking for women
/// Uses year/month for birth interval tracking (0 = never gave birth)
#[derive(Debug, Clone, Copy)]
pub struct Fertility {
    pub last_birth_year: u16,   // 0 = never
    pub last_birth_month: u8,   // 1-12
    pub children_born: u8,      // Total children (max 255)
}

impl Default for Fertility {
    fn default() -> Self {
        Self { last_birth_year: 0, last_birth_month: 0, children_born: 0 }
    }
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
