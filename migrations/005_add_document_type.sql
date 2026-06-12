-- Add a document type to shared HOA documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type text;
