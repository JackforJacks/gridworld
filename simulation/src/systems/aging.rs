//! Aging System - increment age each tick

use hecs::World;
use crate::components::{Age, Alive};

/// Advance age by one month for all living entities
pub fn aging_system(world: &mut World) {
    for (_, age) in world.query_mut::<&mut Age>().with::<&Alive>() {
        age.months += 1;
    }
}
