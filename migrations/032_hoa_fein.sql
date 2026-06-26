-- Association-level FEIN (federal EIN), editable in Association Settings.
-- Reads fall back to a unit's fein (from PropRadar/SunBiz import) when unset.
alter table hoas add column if not exists fein text;
