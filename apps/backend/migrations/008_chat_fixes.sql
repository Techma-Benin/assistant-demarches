ALTER TABLE backend_conversations ADD COLUMN IF NOT EXISTS pending_action jsonb;

UPDATE backend_conversations c
   SET body = jsonb_set(c.body, '{lastMessageAt}', to_jsonb(last.time), true)
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, body->>'time' AS time
      FROM backend_conversation_events
     WHERE body->'data'->>'kind' IN ('message.sent', 'message.received')
     ORDER BY conversation_id, seq DESC
  ) last
 WHERE last.conversation_id = c.id AND last.time IS NOT NULL;
