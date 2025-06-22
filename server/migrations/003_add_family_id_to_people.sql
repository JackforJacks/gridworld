-- Migration: Add family_id to people table
ALTER TABLE people ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES family(id);
