-- Allow HO-4 (renter) policies in the coverage_type check constraint.
alter table policies drop constraint if exists policies_coverage_type_check;
alter table policies add constraint policies_coverage_type_check
  check (coverage_type is null or coverage_type = any (array[
    'ho6_with_wind', 'ho6_wind_excluded', 'wind_only', 'ho4', 'unknown'
  ]));
