-- Association-level SunBiz details (editable in Settings; falls back to unit-derived values)
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS corp_name text;
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS sunbiz_doc_number text;
