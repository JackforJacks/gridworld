//! ECS Systems - process entities each tick
//!
//! Add system modules here as you implement them.

pub mod death;
pub mod matchmaking;
pub mod family;

pub use death::death_system;
pub use matchmaking::matchmaking_system;
pub use family::{family_system, FamilyResult};
