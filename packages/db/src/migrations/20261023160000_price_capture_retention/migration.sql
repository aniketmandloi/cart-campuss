CREATE FUNCTION publishing_price_captured_at(price jsonb) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  retrieved text := price ->> 'retrievedOn';
BEGIN
  IF retrieved ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN (retrieved || 'T00:00:00Z')::timestamptz;
  ELSIF retrieved ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN
    RETURN retrieved::timestamptz;
  END IF;
  RETURN '-infinity'::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN '-infinity'::timestamptz;
END $$;
--> statement-breakpoint
UPDATE publishing_published_assertion
SET captured_at = least(captured_at, publishing_price_captured_at(price_reference))
WHERE price_reference IS NOT NULL;
