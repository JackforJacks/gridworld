-- Migration: Create calendar_state table
CREATE TABLE IF NOT EXISTS calendar_state (
    id INT PRIMARY KEY DEFAULT 1,
    current_year INT NOT NULL,
    current_month INT NOT NULL,
    current_day INT NOT NULL,
    last_updated TIMESTAMP DEFAULT NOW(),
    CONSTRAINT single_row_constraint CHECK (id = 1)
);
