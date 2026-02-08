use tauri::State;

use simulation::components::{BirthDate, Partner, Person, PersonId, Pregnant, Sex, TileId};

use crate::state::{AppState, PersonData};

fn build_person_data(
    world: &simulation::world::SimulationWorld,
    entity: hecs::Entity,
    person: &Person,
    sex: &Sex,
    birth_date: &BirthDate,
    tile_id: &TileId,
) -> PersonData {
    let entity_ref = world.world.entity(entity).unwrap();
    let is_partnered = entity_ref.get::<&Partner>().is_some();
    let is_pregnant = entity_ref.get::<&Pregnant>().is_some();

    let partner_id = if is_partnered {
        entity_ref.get::<&Partner>().and_then(|partner| {
            world
                .world
                .entity(partner.0)
                .ok()
                .and_then(|e| e.get::<&Person>())
                .map(|p| p.id.0 as i64)
        })
    } else {
        None
    };

    PersonData {
        id: person.id.0 as i64,
        first_name: person.first_name.clone(),
        last_name: person.last_name.clone(),
        tile_id: tile_id.0 as i32,
        sex: matches!(sex, Sex::Male),
        birth_year: birth_date.year as i32,
        birth_month: birth_date.month as i32,
        birth_day: birth_date.day as i32,
        age_years: birth_date.age_years(&world.calendar) as i32,
        is_partnered,
        is_pregnant,
        partner_id,
    }
}

#[tauri::command]
pub fn get_all_people(state: State<AppState>) -> Vec<PersonData> {
    let w = state.world.lock().unwrap();
    let mut people = Vec::new();

    for (entity, (person, sex, birth_date, tile_id)) in
        w.world.query::<(&Person, &Sex, &BirthDate, &TileId)>().iter()
    {
        people.push(build_person_data(&w, entity, person, sex, birth_date, tile_id));
    }

    people
}

#[tauri::command]
pub fn get_person(state: State<AppState>, person_id: i64) -> Option<PersonData> {
    let w = state.world.lock().unwrap();
    let target_id = PersonId(person_id as u64);

    for (entity, (person, sex, birth_date, tile_id)) in
        w.world.query::<(&Person, &Sex, &BirthDate, &TileId)>().iter()
    {
        if person.id == target_id {
            return Some(build_person_data(&w, entity, person, sex, birth_date, tile_id));
        }
    }

    None
}

#[tauri::command]
pub fn get_people_by_tile(state: State<AppState>, tile_id: i32) -> Vec<PersonData> {
    let w = state.world.lock().unwrap();
    let target_tile = TileId(tile_id as u16);
    let mut people = Vec::new();

    for (entity, (person, sex, birth_date, tid)) in
        w.world.query::<(&Person, &Sex, &BirthDate, &TileId)>().iter()
    {
        if *tid == target_tile {
            people.push(build_person_data(&w, entity, person, sex, birth_date, tid));
        }
    }

    people
}
