-- Migration: Create families table
CREATE TABLE IF NOT EXISTS families (
    id SERIAL PRIMARY KEY,
    male_id INTEGER NOT NULL REFERENCES people(id),
    female_id INTEGER NOT NULL REFERENCES people(id),
    created_at TIMESTAMP DEFAULT NOW()
);
