ALTER TABLE media ADD COLUMN purpose text NOT NULL DEFAULT 'AVATAR' CHECK(purpose IN ('AVATAR','HEADER','GALLERY','PROJECT','BRANDING'));
ALTER TABLE media ADD COLUMN public_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE identities ADD COLUMN header_media_id text;
ALTER TABLE identities ADD CONSTRAINT identity_header_ownership FOREIGN KEY(header_media_id,id) REFERENCES media(id,identity_id) DEFERRABLE INITIALLY DEFERRED;
