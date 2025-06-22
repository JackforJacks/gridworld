-- Migration: Add pregnancy and delivery_date columns to family table
ALTER TABLE family
ADD COLUMN IF NOT EXISTS pregnancy BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS delivery_date DATE;
