//! ECS Systems - process entities each tick
//!
//! Add system modules here as you implement them.

pub mod aging;  // Kept for reference but not used
pub mod death;
pub mod matchmaking;
pub mod birth;

// Note: aging_system removed - age computed from BirthDay on demand
pub use death::death_system;
pub use matchmaking::matchmaking_system;
pub use birth::birth_system;
