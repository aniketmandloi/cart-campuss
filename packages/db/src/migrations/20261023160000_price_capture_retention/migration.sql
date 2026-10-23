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
--> statement-breakpoint
WITH deadlines AS (
  SELECT assertion.provider_key, assertion.external_id,
    min(CASE WHEN policy.suspended THEN '-infinity'::timestamptz ELSE
      least(assertion.captured_at + policy.retention_seconds * interval '1 second',
        coalesce(policy.permission_expires_at, 'infinity'::timestamptz))
    END) AS deadline
  FROM publishing_published_assertion AS assertion
  JOIN publishing_source_policy AS policy ON policy.id = assertion.source_policy_id
  GROUP BY assertion.provider_key, assertion.external_id
)
UPDATE publishing_published_assertion AS assertion
SET captured_at = least(assertion.captured_at,
  deadlines.deadline - policy.retention_seconds * interval '1 second')
FROM deadlines, publishing_source_policy AS policy
WHERE deadlines.provider_key = assertion.provider_key AND deadlines.external_id = assertion.external_id
  AND policy.id = assertion.source_policy_id;
--> statement-breakpoint
UPDATE publishing_staged_record AS staged
SET captured_at = least(staged.captured_at, (
  SELECT least(
    min(assertion.captured_at),
    min(CASE WHEN prior_policy.suspended THEN '-infinity'::timestamptz ELSE
      least(assertion.captured_at + prior_policy.retention_seconds * interval '1 second',
        coalesce(prior_policy.permission_expires_at, 'infinity'::timestamptz))
        - current_policy.retention_seconds * interval '1 second'
    END)
  )
  FROM publishing_published_assertion AS assertion
  JOIN publishing_source_policy AS prior_policy ON prior_policy.id = assertion.source_policy_id
  WHERE assertion.provider_key = staged.provider_key AND assertion.external_id = staged.external_id
))
FROM publishing_source_policy AS current_policy
WHERE current_policy.id = staged.source_policy_id;
