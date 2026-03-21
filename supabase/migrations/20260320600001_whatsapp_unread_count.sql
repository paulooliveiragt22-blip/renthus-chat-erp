-- Migration: add unread_count to whatsapp_threads + auto-increment trigger

-- 1. Add column
ALTER TABLE whatsapp_threads
    ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

-- 2. Function: increment unread_count when an inbound message arrives
CREATE OR REPLACE FUNCTION increment_thread_unread()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.direction IN ('inbound', 'in') THEN
        UPDATE whatsapp_threads
        SET unread_count = unread_count + 1
        WHERE id = NEW.thread_id;
    END IF;
    RETURN NEW;
END;
$$;

-- 3. Trigger (drop if exists to allow re-run)
DROP TRIGGER IF EXISTS trg_increment_unread ON whatsapp_messages;
CREATE TRIGGER trg_increment_unread
    AFTER INSERT ON whatsapp_messages
    FOR EACH ROW EXECUTE FUNCTION increment_thread_unread();
