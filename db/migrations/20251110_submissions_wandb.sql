-- Add wandb_run JSONB column to submissions (2025-11-10)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS wandb_run JSONB;
