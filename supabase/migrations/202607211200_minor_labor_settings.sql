-- JAY-168 — minor-labor compliance flags. Both nullable; both null means the
-- feature is off, matching the existing "only write when sent" convention
-- already used for weekly_labor_budget_cents/geofence_radius_m/pto_accrual_rate.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS minor_curfew_hour smallint,
  ADD COLUMN IF NOT EXISTS minor_max_daily_hours numeric;
