-- Hilax Hospital: accounts tied to Supabase Auth + role-based row-level security.
-- All tables were empty when this was written (checked 2026-10-30), so reshaping is safe.
-- Browser writes are limited to clinical entry by the right role. Accounts and patient
-- records are created/changed only by Edge Functions (service role), never from the browser.

-- ---------------------------------------------------------------------------
-- 1. Remove old policies and the old public helper functions
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop function if exists public."current_role"();
drop function if exists public.has_role(text);
drop function if exists public.is_hr();

-- ---------------------------------------------------------------------------
-- 2. Roles
-- ---------------------------------------------------------------------------
insert into public.roles (role_name) values
  ('hr_admin'), ('physician'), ('nurse'), ('pharmacist'), ('medtech'), ('radtech'), ('patient')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. users: now the profile of a real Supabase Auth login (no passwords stored here)
-- ---------------------------------------------------------------------------
alter table public.users drop column if exists username;
alter table public.users drop column if exists password;
alter table public.users alter column id drop default;
alter table public.users
  add constraint users_id_fkey foreign key (id) references auth.users (id) on delete cascade;

alter table public.users
  add column login_id text not null,
  add column email text,
  add column staff_number text,
  add column active boolean not null default true,
  add column must_change_password boolean not null default true,
  add column created_by uuid references public.users (id);

alter table public.users alter column full_name set not null;
alter table public.users alter column role_name set not null;

create unique index users_login_id_key on public.users (lower(login_id));
alter table public.users add constraint users_staff_number_key unique (staff_number);
alter table public.users add constraint users_full_name_check
  check (length(trim(full_name)) between 1 and 120);
alter table public.users add constraint users_staff_number_role_check
  check ((role_name = 'patient') = (staff_number is null));

create sequence if not exists public.staff_number_seq;
create sequence if not exists public.patient_number_seq;

-- ---------------------------------------------------------------------------
-- 4. patients: patient number + link to the patient's login
-- ---------------------------------------------------------------------------
alter table public.patients
  add column patient_number text not null
    default ('P-' || lpad(nextval('public.patient_number_seq')::text, 4, '0')),
  add column user_id uuid references public.users (id) on delete set null;

alter table public.patients add constraint patients_patient_number_key unique (patient_number);
alter table public.patients add constraint patients_user_id_key unique (user_id);
alter table public.patients add constraint patients_name_check
  check (length(trim(full_name)) between 1 and 120);
alter table public.patients add constraint patients_age_check check (age between 0 and 150);
alter table public.patients add constraint patients_sex_check
  check (sex in ('male', 'female', 'other'));

-- ---------------------------------------------------------------------------
-- 5. Input checks on clinical tables
-- ---------------------------------------------------------------------------
alter table public.vitals
  add constraint vitals_heart_rate_check check (heart_rate between 20 and 300),
  add constraint vitals_temperature_check check (temperature between 30 and 45),
  add constraint vitals_bp_check check (blood_pressure ~ '^[0-9]{2,3}/[0-9]{2,3}$');

alter table public.prescriptions
  add constraint prescriptions_medication_check check (length(trim(medication_name)) between 1 and 120),
  add constraint prescriptions_dosage_check check (length(trim(dosage)) between 1 and 120),
  add constraint prescriptions_frequency_check check (length(trim(frequency)) between 1 and 120);

alter table public.dispense_logs
  add constraint dispense_notes_check check (notes is null or length(notes) <= 1000);

alter table public.lab_results
  add constraint lab_test_name_check check (length(trim(test_name)) between 1 and 120),
  add constraint lab_results_check check (length(results) <= 5000);

alter table public.imaging_results
  add constraint imaging_type_check check (length(trim(imaging_type)) between 1 and 120),
  add constraint imaging_findings_check check (length(findings) <= 5000);

alter table public.billing
  add constraint billing_amount_check check (amount >= 0),
  add constraint billing_description_check check (length(description) <= 500);

-- ---------------------------------------------------------------------------
-- 6. Private helper functions (not reachable through the public API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_role_name()
returns text
language sql stable security definer
set search_path = ''
as $$
  select u.role_name from public.users u where u.id = (select auth.uid()) and u.active
$$;

create or replace function private.has_any_role(allowed text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.current_role_name() = any (allowed), false)
$$;

create or replace function private.my_patient_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.patient_id
  from public.patients p
  join public.users u on u.id = p.user_id
  where p.user_id = (select auth.uid()) and u.active
$$;

create or replace function private.set_staff_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role_name <> 'patient' and new.staff_number is null then
    new.staff_number := 'S-' || lpad(nextval('public.staff_number_seq')::text, 4, '0');
  end if;
  return new;
end
$$;

create trigger users_set_staff_number
  before insert on public.users
  for each row execute function private.set_staff_number();

revoke execute on function private.current_role_name() from public, anon;
revoke execute on function private.has_any_role(text[]) from public, anon;
revoke execute on function private.my_patient_id() from public, anon;
revoke execute on function private.set_staff_number() from public, anon;
grant execute on function private.current_role_name() to authenticated;
grant execute on function private.has_any_role(text[]) to authenticated;
grant execute on function private.my_patient_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Table privileges: nothing for anon; only what each table needs for signed-in users
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant usage, select on public.staff_number_seq, public.patient_number_seq to service_role;

grant select on public.roles, public.users, public.patients to authenticated;
grant select, insert, update on public.vitals, public.prescriptions,
  public.lab_results, public.imaging_results, public.billing to authenticated;
grant select, insert on public.dispense_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Row-level security on every table
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.patients enable row level security;
alter table public.vitals enable row level security;
alter table public.prescriptions enable row level security;
alter table public.dispense_logs enable row level security;
alter table public.lab_results enable row level security;
alter table public.imaging_results enable row level security;
alter table public.billing enable row level security;

-- roles: readable by signed-in users, never changed from the browser
create policy roles_select on public.roles for select to authenticated using (true);

-- users: see yourself; HR/Admin sees everyone. Changes only via Edge Functions.
create policy users_select_self on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy users_select_hr on public.users for select to authenticated
  using (private.has_any_role(array['hr_admin']));

-- patients: self, HR/Admin, and clinical staff can read. Changes only via Edge Functions.
create policy patients_select_self on public.patients for select to authenticated
  using (user_id = (select auth.uid()));
create policy patients_select_hr on public.patients for select to authenticated
  using (private.has_any_role(array['hr_admin']));
create policy patients_select_clinical on public.patients for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'pharmacist', 'medtech', 'radtech']));

-- vitals: clinical staff read; nurses write their own entries; patient reads own
create policy vitals_select_clinical on public.vitals for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'pharmacist', 'medtech', 'radtech']));
create policy vitals_select_self on public.vitals for select to authenticated
  using (patient_id = private.my_patient_id());
create policy vitals_insert_nurse on public.vitals for insert to authenticated
  with check (private.has_any_role(array['nurse']) and nurse_id = (select auth.uid()));
create policy vitals_update_nurse on public.vitals for update to authenticated
  using (private.has_any_role(array['nurse']) and nurse_id = (select auth.uid()))
  with check (private.has_any_role(array['nurse']) and nurse_id = (select auth.uid()));

-- prescriptions: physicians write their own; physician/nurse/pharmacist read; patient reads own
create policy prescriptions_select_staff on public.prescriptions for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'pharmacist']));
create policy prescriptions_select_self on public.prescriptions for select to authenticated
  using (patient_id = private.my_patient_id());
create policy prescriptions_insert_physician on public.prescriptions for insert to authenticated
  with check (private.has_any_role(array['physician']) and physician_id = (select auth.uid()));
create policy prescriptions_update_physician on public.prescriptions for update to authenticated
  using (private.has_any_role(array['physician']) and physician_id = (select auth.uid()))
  with check (private.has_any_role(array['physician']) and physician_id = (select auth.uid()));

-- dispense_logs: pharmacists add (no edits/deletes, it is a log); physician/nurse/pharmacist read; patient reads own
create policy dispense_select_staff on public.dispense_logs for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'pharmacist']));
create policy dispense_select_self on public.dispense_logs for select to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.prescription_id = dispense_logs.prescription_id
      and p.patient_id = private.my_patient_id()
  ));
create policy dispense_insert_pharmacist on public.dispense_logs for insert to authenticated
  with check (private.has_any_role(array['pharmacist']) and pharmacist_id = (select auth.uid()));

-- lab_results: medtechs write their own; physician/nurse/medtech read; patient reads own
create policy lab_select_staff on public.lab_results for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'medtech']));
create policy lab_select_self on public.lab_results for select to authenticated
  using (patient_id = private.my_patient_id());
create policy lab_insert_medtech on public.lab_results for insert to authenticated
  with check (private.has_any_role(array['medtech']) and medtech_id = (select auth.uid()));
create policy lab_update_medtech on public.lab_results for update to authenticated
  using (private.has_any_role(array['medtech']) and medtech_id = (select auth.uid()))
  with check (private.has_any_role(array['medtech']) and medtech_id = (select auth.uid()));

-- imaging_results: radtechs write their own; physician/nurse/radtech read; patient reads own
create policy imaging_select_staff on public.imaging_results for select to authenticated
  using (private.has_any_role(array['physician', 'nurse', 'radtech']));
create policy imaging_select_self on public.imaging_results for select to authenticated
  using (patient_id = private.my_patient_id());
create policy imaging_insert_radtech on public.imaging_results for insert to authenticated
  with check (private.has_any_role(array['radtech']) and radtech_id = (select auth.uid()));
create policy imaging_update_radtech on public.imaging_results for update to authenticated
  using (private.has_any_role(array['radtech']) and radtech_id = (select auth.uid()))
  with check (private.has_any_role(array['radtech']) and radtech_id = (select auth.uid()));

-- billing: HR/Admin manages; patient reads own
create policy billing_select_hr on public.billing for select to authenticated
  using (private.has_any_role(array['hr_admin']));
create policy billing_select_self on public.billing for select to authenticated
  using (patient_id = private.my_patient_id());
create policy billing_insert_hr on public.billing for insert to authenticated
  with check (private.has_any_role(array['hr_admin']));
create policy billing_update_hr on public.billing for update to authenticated
  using (private.has_any_role(array['hr_admin']))
  with check (private.has_any_role(array['hr_admin']));
