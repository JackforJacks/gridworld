-- Migration: Create family table
CREATE TABLE IF NOT EXISTS family (
    id SERIAL PRIMARY KEY,
    husband_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    wife_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    pregnancy BOOLEAN DEFAULT FALSE,
    delivery_date DATE,
    children_ids INTEGER[] DEFAULT '{}',
    tile_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_family_husband_id ON family(husband_id);
CREATE INDEX IF NOT EXISTS idx_family_wife_id ON family(wife_id);
CREATE INDEX IF NOT EXISTS idx_family_tile_id ON family(tile_id);
CREATE INDEX IF NOT EXISTS idx_family_pregnancy ON family(pregnancy);
CREATE INDEX IF NOT EXISTS idx_family_delivery_date ON family(delivery_date);
