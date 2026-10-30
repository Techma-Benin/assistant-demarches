-- Files are opaque private uploads: antivirus scanning is no longer required.
UPDATE backend_files SET body = body - 'scanStatus' WHERE body ? 'scanStatus';
-- Keep successful upload idempotency replays conformant to the updated File schema.
UPDATE backend_idempotency SET response = response - 'scanStatus'
WHERE response ? 'scanStatus' AND response->>'id' LIKE 'fil_%';
