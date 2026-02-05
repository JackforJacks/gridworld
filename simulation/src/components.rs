//! ECS Components for GridWorld entities
//!
//! Add components here as you design the simulation.

use serde::{Deserialize, Serialize};

// ============================================================================
// Identity Components
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PersonId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FamilyId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VillageId(pub u64);

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Age {
    pub months: u32,
}

impl Age {
    pub fn new(years: u32) -> Self {
        Self { months: years * 12 }
    }

    pub fn years(&self) -> u32 {
        self.months / 12
    }
}

/// Marker: entity is alive
#[derive(Debug, Clone, Copy, Default)]
pub struct Alive;

// ============================================================================
// Calendar
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Calendar {
    pub tick: u64,
    pub month: u8,
    pub year: i32,
}

impl Calendar {
    pub fn advance(&mut self) {
        self.tick += 1;
        self.month += 1;
        if self.month > 12 {
            self.month = 1;
            self.year += 1;
        }
    }
}
