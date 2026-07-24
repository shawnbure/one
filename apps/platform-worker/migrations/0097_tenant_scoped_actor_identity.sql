ALTER TABLE agent_blueprints ADD COLUMN actor_identity_version INTEGER NOT NULL DEFAULT 2
  CHECK (actor_identity_version IN (1, 2));

-- Preserve every actor created before tenant-prefixed identity existed. New process
-- definitions inherit v2 from the column default and cannot silently orphan memory.
UPDATE agent_blueprints SET actor_identity_version = 1;
