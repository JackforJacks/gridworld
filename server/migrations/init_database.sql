-- GridWorld Database Initialization
-- This file consolidates all database schema creation in one place

-- 1. Create tiles table (if not exists)
CREATE TABLE IF NOT EXISTS tiles (
    id SERIAL PRIMARY KEY,
    center_x REAL NOT NULL,
    center_y REAL NOT NULL,
    center_z REAL NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    terrain_type VARCHAR(50) NOT NULL,
    is_land BOOLEAN NOT NULL DEFAULT FALSE,
    is_habitable BOOLEAN NOT NULL DEFAULT FALSE,
    boundary_points JSONB,
    neighbor_ids INTEGER[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add biome column if it doesn't exist
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS biome VARCHAR(50);

-- Add fertility column if it doesn't exist (0-100 scale)
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS fertility INTEGER CHECK (fertility >= 0 AND fertility <= 100);

-- Add housing_capacity to villages if missing
ALTER TABLE villages ADD COLUMN IF NOT EXISTS housing_capacity INTEGER DEFAULT 100;
-- Add food_capacity to villages if missing
ALTER TABLE villages ADD COLUMN IF NOT EXISTS food_capacity INTEGER DEFAULT 1000;

-- 1a. Create tiles_lands table (each tile has 100 land chunks)
CREATE TABLE IF NOT EXISTS tiles_lands (
    id SERIAL PRIMARY KEY,
    tile_id INTEGER NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 100),
    land_type TEXT NOT NULL CHECK (land_type IN ('wasteland', 'forest', 'cleared')),
    cleared BOOLEAN DEFAULT FALSE,
    owner_id INT,
    UNIQUE(tile_id, chunk_index)
);

-- 1b. Create villages table
CREATE TABLE IF NOT EXISTS villages (
    id SERIAL PRIMARY KEY,
    tile_id INTEGER NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
    land_chunk_index INTEGER NOT NULL CHECK (land_chunk_index >= 0 AND land_chunk_index < 100),
    name TEXT DEFAULT 'Village',
    housing_slots JSONB DEFAULT '[]',
    housing_capacity INTEGER DEFAULT 100,
    food_stores INTEGER DEFAULT 0,
    food_capacity INTEGER DEFAULT 1000,
    food_production_rate REAL DEFAULT 0,
    last_food_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tile_id, land_chunk_index)
);

-- 1c. Ensure tiles_lands has a village reference for residency tracking
ALTER TABLE tiles_lands
    ADD COLUMN IF NOT EXISTS village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tiles_lands_village_id ON tiles_lands(village_id);

-- 2. Create people table
CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,
    tile_id INTEGER REFERENCES tiles(id) ON DELETE SET NULL,
    sex BOOLEAN,
    date_of_birth DATE,
    residency INTEGER,
    family_id INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create family table
CREATE TABLE IF NOT EXISTS family (
    id SERIAL PRIMARY KEY,
    husband_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    wife_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    pregnancy BOOLEAN DEFAULT FALSE,
    delivery_date DATE,
    children_ids INTEGER[] DEFAULT '{}',
    tile_id INTEGER REFERENCES tiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create calendar_state table
CREATE TABLE IF NOT EXISTS calendar_state (
    id INT PRIMARY KEY DEFAULT 1,
    current_year INT NOT NULL,
    current_month INT NOT NULL,
    current_day INT NOT NULL,
    last_updated TIMESTAMP DEFAULT NOW(),
    CONSTRAINT single_row_constraint CHECK (id = 1)
);

-- 5. Add family_id reference to people table (if not already added)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE table_name = 'people' AND constraint_name = 'fk_people_family') THEN
        ALTER TABLE people ADD CONSTRAINT fk_people_family 
            FOREIGN KEY (family_id) REFERENCES family(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6. Create indexes for performance

-- Tiles indexes
CREATE INDEX IF NOT EXISTS idx_tiles_terrain_type ON tiles(terrain_type);
CREATE INDEX IF NOT EXISTS idx_tiles_is_land ON tiles(is_land);
CREATE INDEX IF NOT EXISTS idx_tiles_is_habitable ON tiles(is_habitable);
CREATE INDEX IF NOT EXISTS idx_tiles_latitude ON tiles(latitude);
CREATE INDEX IF NOT EXISTS idx_tiles_longitude ON tiles(longitude);

-- Create biome index (biome column should exist by now)
CREATE INDEX IF NOT EXISTS idx_tiles_biome ON tiles(biome);

-- Create fertility index for performance
CREATE INDEX IF NOT EXISTS idx_tiles_fertility ON tiles(fertility);

-- People indexes
CREATE INDEX IF NOT EXISTS idx_people_tile_id ON people(tile_id);
CREATE INDEX IF NOT EXISTS idx_people_residency ON people(residency);
CREATE INDEX IF NOT EXISTS idx_people_family_id ON people(family_id);
CREATE INDEX IF NOT EXISTS idx_people_sex ON people(sex);
CREATE INDEX IF NOT EXISTS idx_people_date_of_birth ON people(date_of_birth);

-- Family indexes
CREATE INDEX IF NOT EXISTS idx_family_husband_id ON family(husband_id);
CREATE INDEX IF NOT EXISTS idx_family_wife_id ON family(wife_id);
CREATE INDEX IF NOT EXISTS idx_family_tile_id ON family(tile_id);
CREATE INDEX IF NOT EXISTS idx_family_pregnancy ON family(pregnancy);
CREATE INDEX IF NOT EXISTS idx_family_delivery_date ON family(delivery_date);

-- 7. Create schema_migrations table for tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Insert migration records
INSERT INTO schema_migrations (version) VALUES 
    ('000_create_people_table'),
    ('001_create_calendar_state'),
    ('002_create_family_table'),
    ('002_add_family_id_to_people'),
    ('003_add_family_id_to_people'),
    ('004_add_pregnancy_to_families'),
    ('005_add_biome_to_tiles'),
    ('init_database')
ON CONFLICT (version) DO NOTHING;

-- 9. Comments for documentation
COMMENT ON TABLE tiles IS 'Stores hexagonal tiles that make up the world grid';
COMMENT ON TABLE people IS 'Stores individual population members';
COMMENT ON TABLE family IS 'Stores family units and relationships';
COMMENT ON TABLE calendar_state IS 'Stores current world time state';

COMMENT ON COLUMN tiles.biome IS 'Biome type: tundra, desert, plains, grassland, alpine';
COMMENT ON COLUMN tiles.terrain_type IS 'Terrain type: ocean, flats, hills, mountains';
COMMENT ON COLUMN tiles.fertility IS 'Agricultural/biological productivity from 0 (barren) to 100 (highly fertile)';
COMMENT ON COLUMN people.sex IS 'Boolean: true for male, false for female';
COMMENT ON COLUMN people.residency IS 'Number of days living on current tile';
