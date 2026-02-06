//! Persistence module for export/import of simulation state
//!
//! Serializes the entire ECS world to JSON for database storage and restores it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use hecs::World;

use crate::components::*;

// ============================================================================
// Export Data Structures
// ============================================================================

/// Complete world state for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
    pub version: u8,  // Schema version for forward compatibility
    pub calendar: CalendarData,
    pub next_person_id: u64,
    pub people: Vec<ExportedPerson>,
}

/// Calendar state (matches our Calendar component)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarData {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

/// Single person with all their components
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedPerson {
    pub person_id: u64,
    pub tile_id: u16,
    pub first_name: String,
    pub last_name: String,
    pub sex: ExportedSex,
    pub birth_year: u16,
    pub birth_month: u8,
    pub birth_day: u8,
    /// PersonId of partner (None = single)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partner_id: Option<u64>,
    /// PersonId of mother (None = genesis seed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mother_id: Option<u64>,
    /// Fertility data (only for women who've given birth)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fertility: Option<ExportedFertility>,
    /// Pregnancy data (only for currently pregnant women)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pregnancy: Option<ExportedPregnancy>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExportedSex {
    Male,
    Female,
}

impl From<Sex> for ExportedSex {
    fn from(sex: Sex) -> Self {
        match sex {
            Sex::Male => ExportedSex::Male,
            Sex::Female => ExportedSex::Female,
        }
    }
}

impl From<ExportedSex> for Sex {
    fn from(sex: ExportedSex) -> Self {
        match sex {
            ExportedSex::Male => Sex::Male,
            ExportedSex::Female => Sex::Female,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedFertility {
    pub last_birth_year: u16,
    pub last_birth_month: u8,
    pub children_born: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedPregnancy {
    pub due_year: u16,
    pub due_month: u8,
}

// ============================================================================
// Export Implementation
// ============================================================================

impl crate::world::SimulationWorld {
    /// Export entire world state to JSON string
    pub fn export_world(&self) -> String {
        let mut people: Vec<ExportedPerson> = Vec::new();
        
        // Build PersonId -> Entity map for Partner/Mother reference lookup
        let mut person_id_to_entity: HashMap<u64, hecs::Entity> = HashMap::new();
        let mut entity_to_person_id: HashMap<hecs::Entity, u64> = HashMap::new();
        
        // First pass: collect all PersonIds and map to entities
        for (entity, person) in self.world.query::<&Person>().iter() {
            person_id_to_entity.insert(person.id.0, entity);
            entity_to_person_id.insert(entity, person.id.0);
        }
        
        // Second pass: export all people with components
        for (entity, (person, tile, birth, sex)) in self
            .world
            .query::<(&Person, &TileId, &BirthDate, &Sex)>()
            .iter()
        {
            // Get optional components
            let partner_id = self.world.get::<&Partner>(entity)
                .ok()
                .and_then(|p| entity_to_person_id.get(&p.0).copied());
            
            let mother_id = self.world.get::<&Mother>(entity)
                .ok()
                .and_then(|m| entity_to_person_id.get(&m.0).copied());
            
            let fertility = self.world.get::<&Fertility>(entity)
                .ok()
                .map(|f| ExportedFertility {
                    last_birth_year: f.last_birth_year,
                    last_birth_month: f.last_birth_month,
                    children_born: f.children_born,
                });
            
            let pregnancy = self.world.get::<&Pregnant>(entity)
                .ok()
                .map(|p| ExportedPregnancy {
                    due_year: p.due_year,
                    due_month: p.due_month,
                });
            
            people.push(ExportedPerson {
                person_id: person.id.0,
                tile_id: tile.0,
                first_name: person.first_name.clone(),
                last_name: person.last_name.clone(),
                sex: (*sex).into(),
                birth_year: birth.year,
                birth_month: birth.month,
                birth_day: birth.day,
                partner_id,
                mother_id,
                fertility,
                pregnancy,
            });
        }
        
        let export_data = ExportData {
            version: 1,
            calendar: CalendarData {
                year: self.calendar.year,
                month: self.calendar.month,
                day: self.calendar.day,
            },
            next_person_id: self.next_person_id,
            people,
        };
        
        serde_json::to_string(&export_data).unwrap_or_else(|_| "{}".to_string())
    }

    /// Import world state from JSON string, replacing current state
    pub fn import_world(&mut self, json: &str) -> Result<ImportResult, String> {
        let data: ExportData = serde_json::from_str(json)
            .map_err(|e| format!("JSON parse error: {}", e))?;
        
        // Validate version
        if data.version != 1 {
            return Err(format!("Unsupported export version: {}", data.version));
        }
        
        // Clear existing world
        self.world.clear();
        
        // Restore calendar
        self.calendar = Calendar::new(data.calendar.year, data.calendar.month, data.calendar.day);
        self.next_person_id = data.next_person_id;
        
        // First pass: spawn all entities with basic components, build PersonId -> Entity map
        let mut person_id_to_entity: HashMap<u64, hecs::Entity> = HashMap::new();
        
        for person in &data.people {
            let entity = self.world.spawn((
                Person {
                    id: PersonId(person.person_id),
                    first_name: person.first_name.clone(),
                    last_name: person.last_name.clone(),
                },
                TileId(person.tile_id),
                BirthDate::new(person.birth_year, person.birth_month, person.birth_day),
                Sex::from(person.sex),
            ));
            
            // Add Fertility if present
            if let Some(ref fert) = person.fertility {
                let _ = self.world.insert_one(entity, Fertility {
                    last_birth_year: fert.last_birth_year,
                    last_birth_month: fert.last_birth_month,
                    children_born: fert.children_born,
                });
            }
            
            // Add Pregnancy if present
            if let Some(ref preg) = person.pregnancy {
                let _ = self.world.insert_one(entity, Pregnant {
                    due_year: preg.due_year,
                    due_month: preg.due_month,
                });
            }
            
            person_id_to_entity.insert(person.person_id, entity);
        }
        
        // Second pass: restore Partner and Mother references
        let mut partners_added = 0u32;
        let mut mothers_added = 0u32;
        
        for person in &data.people {
            let entity = person_id_to_entity[&person.person_id];
            
            // Restore Partner
            if let Some(partner_pid) = person.partner_id {
                if let Some(&partner_entity) = person_id_to_entity.get(&partner_pid) {
                    let _ = self.world.insert_one(entity, Partner(partner_entity));
                    partners_added += 1;
                }
            }
            
            // Restore Mother
            if let Some(mother_pid) = person.mother_id {
                if let Some(&mother_entity) = person_id_to_entity.get(&mother_pid) {
                    let _ = self.world.insert_one(entity, Mother(mother_entity));
                    mothers_added += 1;
                }
            }
        }
        
        Ok(ImportResult {
            population: data.people.len() as u32,
            partners: partners_added,
            mothers: mothers_added,
            calendar_year: self.calendar.year,
        })
    }
}

/// Result of import operation
#[derive(Debug, Clone)]
pub struct ImportResult {
    pub population: u32,
    pub partners: u32,
    pub mothers: u32,
    pub calendar_year: u16,
}
