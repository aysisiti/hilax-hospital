-- Clinical records are write-once: once saved, nobody can edit them through the API.
-- A correction is entered as a new record. (Bills stay as they are: the only
-- change allowed is marking a bill paid.)
drop policy if exists vitals_update_nurse on public.vital_signs;
drop policy if exists prescriptions_update_physician on public.prescriptions;
drop policy if exists lab_update_medtech on public.lab_results;
drop policy if exists imaging_update_radtech on public.imaging_results;

revoke update on public.vital_signs, public.prescriptions, public.lab_results, public.imaging_results
  from authenticated, anon;
