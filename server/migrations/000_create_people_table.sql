-- Migration: Create people table
CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    tile_id INTEGER,
    sex BOOLEAN,
    date_of_birth DATE,
    residency INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_people_tile_id ON people(tile_id);
CREATE INDEX IF NOT EXISTS idx_people_residency ON people(residency);
