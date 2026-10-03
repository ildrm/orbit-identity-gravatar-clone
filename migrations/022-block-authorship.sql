ALTER TABLE profile_blocks ADD COLUMN actor_id text REFERENCES accounts(id);
