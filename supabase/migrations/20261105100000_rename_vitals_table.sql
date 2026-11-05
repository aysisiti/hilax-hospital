-- Ad blockers and privacy extensions block web addresses containing "vitals"
-- (they mistake them for "Web Vitals" page-speed tracking), so the patient's
-- vitals tab failed to load for people using them. Renamed to something neutral.
-- Policies, checks, indexes and foreign keys move with the table automatically.
alter table public.vitals rename to vital_signs;
alter table public.vital_signs rename column vitals_id to vital_id;
