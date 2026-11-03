ALTER TABLE backend_conversations ADD actions_paused boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX backend_procedure_identifiers ON backend_configurations(resource_id) WHERE resource='procedures';
