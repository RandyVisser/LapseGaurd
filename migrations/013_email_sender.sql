-- Who owner-facing emails are presented as coming from (reply-to + signature)
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS email_sender_role text DEFAULT 'property_manager';
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS email_sender_unit_id uuid;
