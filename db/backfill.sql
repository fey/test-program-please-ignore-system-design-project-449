-- Снимок неизменяемых полей поездок для начальной загрузки.
SELECT jsonb_build_object(
    'eventId', md5('snapshot-' || t.id || '-' || k.kind)::uuid,
    'tripId', t.id, 'eventType', k.kind, 'version', CASE WHEN k.kind='created' THEN 1 ELSE GREATEST(t.version,2) END,
    'city', t.city, 'price', t.price, 'historical', true,
    'createdAt', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'occurredAt', to_char(k.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS payload
FROM trips t CROSS JOIN LATERAL (
  VALUES ('created', t.created_at), ('completed', t.completed_at)
) k(kind, at)
WHERE k.at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outbox o WHERE o.payload->>'tripId'=t.id::text AND o.payload->>'eventType'=k.kind
)
;
