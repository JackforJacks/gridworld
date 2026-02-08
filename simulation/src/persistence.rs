//! Persistence module for export/import of simulation state
//!
//! Supports two formats:
//! - JSON export/import (for live sync with Node.js)
//! - Bincode save files (for fast local persistence)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
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
    pub event_log: Vec<ExportedEvent>,
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
    pub partner_id: Option<u64>,
    /// PersonId of mother (None = genesis seed)
    pub mother_id: Option<u64>,
    /// Fertility data (only for women who've given birth)
    pub fertility: Option<ExportedFertility>,
    /// Pregnancy data (only for currently pregnant women)
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

/// Exported event from event log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedEvent {
    pub event_type: ExportedEventType,
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub person_id: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExportedEventType {
    Birth,
    Death,
    Marriage,
    PregnancyStarted,
    Dissolution,
}

impl From<EventType> for ExportedEventType {
    fn from(et: EventType) -> Self {
        match et {
            EventType::Birth => ExportedEventType::Birth,
            EventType::Death => ExportedEventType::Death,
            EventType::Marriage => ExportedEventType::Marriage,
            EventType::PregnancyStarted => ExportedEventType::PregnancyStarted,
            EventType::Dissolution => ExportedEventType::Dissolution,
        }
    }
}

impl From<ExportedEventType> for EventType {
    fn from(et: ExportedEventType) -> Self {
        match et {
            ExportedEventType::Birth => EventType::Birth,
            ExportedEventType::Death => EventType::Death,
            ExportedEventType::Marriage => EventType::Marriage,
            ExportedEventType::PregnancyStarted => EventType::PregnancyStarted,
            ExportedEventType::Dissolution => EventType::Dissolution,
        }
    }
}

// ============================================================================
// Export Implementation
// ============================================================================

impl crate::world::SimulationWorld {
    /// Export entire world state to JSON string
    pub fn export_world(&self) -> String {
        let export_data = self.build_export_data();
        serde_json::to_string(&export_data).unwrap_or_else(|_| "{}".to_string())
    }

    /// Import world state from JSON string, replacing current state
    pub fn import_world(&mut self, json: &str) -> Result<ImportResult, String> {
        let data: ExportData = serde_json::from_str(json)
            .map_err(|e| format!("JSON parse error: {}", e))?;
        self.import_from_export_data(data)
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

// ============================================================================
// Bincode Save File
// ============================================================================

/// On-disk save file format (bincode-serialized)
#[derive(Serialize, Deserialize)]
pub struct SaveFile {
    pub version: u8,
    pub seed: u32,
    pub ecs_data: ExportData,
    /// Node-side state (families, person extensions) stored as raw JSON bytes
    pub node_state: Vec<u8>,
}

/// Stats returned after saving
#[derive(Debug, Clone)]
pub struct SaveStats {
    pub population: u32,
    pub file_bytes: u64,
}

/// Stats returned after loading
#[derive(Debug, Clone)]
pub struct LoadFileResult {
    pub import_result: ImportResult,
    pub seed: u32,
    pub node_state_json: String,
}

impl crate::world::SimulationWorld {
    /// Build ExportData from current world state (shared by export_world and save_to_file)
    fn build_export_data(&self) -> ExportData {
        let mut people: Vec<ExportedPerson> = Vec::new();

        let mut person_id_to_entity: HashMap<u64, hecs::Entity> = HashMap::new();
        let mut entity_to_person_id: HashMap<hecs::Entity, u64> = HashMap::new();

        for (entity, person) in self.world.query::<&Person>().iter() {
            person_id_to_entity.insert(person.id.0, entity);
            entity_to_person_id.insert(entity, person.id.0);
        }

        for (entity, (person, tile, birth, sex)) in self
            .world
            .query::<(&Person, &TileId, &BirthDate, &Sex)>()
            .iter()
        {
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

        // Export event log
        let event_log = self.event_log.get_all()
            .into_iter()
            .map(|event| ExportedEvent {
                event_type: event.event_type.into(),
                year: event.year,
                month: event.month,
                day: event.day,
                person_id: event.person_id,
            })
            .collect();

        ExportData {
            version: 1,
            calendar: CalendarData {
                year: self.calendar.year,
                month: self.calendar.month,
                day: self.calendar.day,
            },
            next_person_id: self.next_person_id,
            people,
            event_log,
        }
    }

    /// Import from ExportData (shared by import_world and load_from_file)
    fn import_from_export_data(&mut self, data: ExportData) -> Result<ImportResult, String> {
        if data.version != 1 {
            return Err(format!("Unsupported export version: {}", data.version));
        }

        self.world.clear();
        self.calendar = Calendar::new(data.calendar.year, data.calendar.month, data.calendar.day);
        self.next_person_id = data.next_person_id;

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

            if let Some(ref fert) = person.fertility {
                let _ = self.world.insert_one(entity, Fertility {
                    last_birth_year: fert.last_birth_year,
                    last_birth_month: fert.last_birth_month,
                    children_born: fert.children_born,
                });
            }

            if let Some(ref preg) = person.pregnancy {
                let _ = self.world.insert_one(entity, Pregnant {
                    due_year: preg.due_year,
                    due_month: preg.due_month,
                });
            }

            person_id_to_entity.insert(person.person_id, entity);
        }

        let mut partners_added = 0u32;
        let mut mothers_added = 0u32;

        for person in &data.people {
            let entity = person_id_to_entity[&person.person_id];

            if let Some(partner_pid) = person.partner_id {
                if let Some(&partner_entity) = person_id_to_entity.get(&partner_pid) {
                    let _ = self.world.insert_one(entity, Partner(partner_entity));
                    partners_added += 1;
                }
            }

            if let Some(mother_pid) = person.mother_id {
                if let Some(&mother_entity) = person_id_to_entity.get(&mother_pid) {
                    let _ = self.world.insert_one(entity, Mother(mother_entity));
                    mothers_added += 1;
                }
            }
        }

        // Restore event log
        self.event_log.clear();
        for event in data.event_log {
            self.event_log.push(Event {
                event_type: event.event_type.into(),
                year: event.year,
                month: event.month,
                day: event.day,
                person_id: event.person_id,
            });
        }

        Ok(ImportResult {
            population: data.people.len() as u32,
            partners: partners_added,
            mothers: mothers_added,
            calendar_year: self.calendar.year,
        })
    }

    /// Save world + Node state to a bincode file (atomic write via tmp + rename)
    pub fn save_to_file(&self, node_state_json: &str, seed: u32, path: &str) -> Result<SaveStats, String> {
        let ecs_data = self.build_export_data();
        let population = ecs_data.people.len() as u32;

        let save_file = SaveFile {
            version: 1,
            seed,
            ecs_data,
            node_state: node_state_json.as_bytes().to_vec(),
        };

        let encoded = bincode::serialize(&save_file)
            .map_err(|e| format!("Bincode serialize error: {}", e))?;

        let file_bytes = encoded.len() as u64;

        // Atomic write: write to .tmp then rename
        let tmp_path = format!("{}.tmp", path);

        // Ensure parent directory exists
        if let Some(parent) = Path::new(path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create save directory: {}", e))?;
        }

        std::fs::write(&tmp_path, &encoded)
            .map_err(|e| format!("Failed to write tmp file: {}", e))?;

        std::fs::rename(&tmp_path, path)
            .map_err(|e| format!("Failed to rename tmp to final: {}", e))?;

        Ok(SaveStats { population, file_bytes })
    }

    /// Load world + Node state from a bincode file
    pub fn load_from_file(&mut self, path: &str) -> Result<LoadFileResult, String> {
        let data = std::fs::read(path)
            .map_err(|e| format!("Failed to read save file: {}", e))?;

        let save_file: SaveFile = bincode::deserialize(&data)
            .map_err(|e| format!("Bincode deserialize error: {}", e))?;

        if save_file.version != 1 {
            return Err(format!("Unsupported save file version: {}", save_file.version));
        }

        let node_state_json = String::from_utf8(save_file.node_state)
            .map_err(|e| format!("Invalid UTF-8 in node_state: {}", e))?;

        let import_result = self.import_from_export_data(save_file.ecs_data)?;

        Ok(LoadFileResult {
            import_result,
            seed: save_file.seed,
            node_state_json,
        })
    }
}
