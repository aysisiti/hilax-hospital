-- Billing: bills can be marked as paid, and nothing else about a bill can change.
--   * HR/Admin adds bills (patient, amount, description) and marks them paid.
--   * Marking paid is one-way: paid_at / paid_by are set by the database
--     (time = now, who = the signed-in admin) and cannot be changed afterwards.
--   * Amount must be above 0 and at most 10,000,000. Description 1-500 characters.
--   * Patients still only read their own bills. Nobody deletes bills.

alter table public.billing
  add column paid_at timestamp,
  add column paid_by uuid references public.users (id) on delete restrict;

alter table public.billing drop constraint billing_amount_check;
alter table public.billing drop constraint billing_description_check;
alter table public.billing
  add constraint billing_amount_check check (amount > 0 and amount <= 10000000),
  add constraint billing_description_check check (length(btrim(description)) between 1 and 500),
  add constraint billing_paid_pair_check check ((paid_at is null) = (paid_by is null));

-- Admin may only choose patient/amount/description on insert and only touch paid_at on update.
revoke insert, update on public.billing from authenticated;
grant insert (patient_id, amount, description) on public.billing to authenticated;
grant update (paid_at) on public.billing to authenticated;

create or replace function private.billing_mark_paid()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.paid_at is not null then
    raise exception 'Bill is already paid' using errcode = '23514';
  end if;
  if new.paid_at is null then
    raise exception 'Bill can only be marked as paid' using errcode = '23514';
  end if;
  new.paid_at := (now() at time zone 'utc');
  new.paid_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.billing_mark_paid() from public, anon, authenticated;

create trigger billing_mark_paid
  before update on public.billing
  for each row execute function private.billing_mark_paid();
