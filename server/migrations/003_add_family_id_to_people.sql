-- Migration: Add family_id to people table
ALTER TABLE people ADD COLUMN family_id INTEGER REFERENCES families(id);
