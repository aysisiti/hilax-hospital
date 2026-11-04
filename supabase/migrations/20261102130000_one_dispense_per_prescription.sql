-- A prescription can be dispensed only once. The dispense log cannot be edited or
-- deleted from the browser, so this keeps it a clean record and stops a double
-- tap (or two pharmacists) from dispensing the same prescription twice.
-- Existing data already has at most one log per prescription.
alter table public.dispense_logs
  add constraint dispense_logs_prescription_key unique (prescription_id);
