-- Migration: Add rust_simulation_state table
-- This table stores the complete Rust ECS simulation state as JSON
-- for persistence across server restarts

CREATE TABLE IF NOT EXISTS rust_simulation_state (
    id INT PRIMARY KEY DEFAULT 1,
    state_json TEXT NOT NULL,
    population INT NOT NULL DEFAULT 0,
    calendar_year INT NOT NULL DEFAULT 4000,
    last_updated TIMESTAMP DEFAULT NOW(),
    CONSTRAINT single_rust_state CHECK (id = 1)
);

COMMENT ON TABLE rust_simulation_state IS 'Stores serialized Rust ECS simulation state';
COMMENT ON COLUMN rust_simulation_state.state_json IS 'Complete world state as JSON (all entities with components)';
COMMENT ON COLUMN rust_simulation_state.population IS 'Population count at time of save (for quick queries)';
COMMENT ON COLUMN rust_simulation_state.calendar_year IS 'Calendar year at time of save';

-- Insert migration record
INSERT INTO schema_migrations (version) VALUES ('006_add_rust_simulation_state')
ON CONFLICT (version) DO NOTHING;
