ALTER TABLE media DROP CONSTRAINT media_status_check;
ALTER TABLE media ADD CONSTRAINT media_status_check CHECK(status IN ('PENDING','PROCESSING','READY','REJECTED','FAILED','DELETED'));
ALTER TABLE media ADD CONSTRAINT media_identity_unique UNIQUE(id,identity_id);
ALTER TABLE identities DROP CONSTRAINT identity_avatar_fk;
ALTER TABLE identities ADD CONSTRAINT identity_avatar_fk FOREIGN KEY(avatar_media_id,id) REFERENCES media(id,identity_id);
ALTER TABLE personas DROP CONSTRAINT persona_avatar_fk;
ALTER TABLE personas ADD CONSTRAINT persona_avatar_fk FOREIGN KEY(avatar_media_id,identity_id) REFERENCES media(id,identity_id);
