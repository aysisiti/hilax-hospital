-- Vitals: stricter server-side input checks (the browser checks too, but the
-- database is what decides). Existing rows already satisfy these rules.

-- Blood pressure "systolic/diastolic": plausible ranges and systolic above diastolic.
alter table public.vitals
  add constraint vitals_bp_range_check check (
    case
      when blood_pressure ~ '^[0-9]{2,3}/[0-9]{2,3}$' then
        split_part(blood_pressure, '/', 1)::int between 50 and 300
        and split_part(blood_pressure, '/', 2)::int between 30 and 200
        and split_part(blood_pressure, '/', 1)::int > split_part(blood_pressure, '/', 2)::int
      else false
    end
  );

-- Temperature in degrees Celsius with at most one decimal place (e.g. 36.8).
alter table public.vitals
  add constraint vitals_temperature_scale_check check (scale(temperature) <= 1);
