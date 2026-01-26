-- Migration to add food production columns to villages table
-- Run this after the initial database setup

ALTER TABLE villages
ADD COLUMN IF NOT EXISTS food_stores INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS food_production_rate REAL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_food_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update existing villages with default values
UPDATE villages
SET food_stores = 0,
    food_production_rate = 0,
    last_food_update = CURRENT_TIMESTAMP
WHERE food_stores IS NULL OR food_production_rate IS NULL;