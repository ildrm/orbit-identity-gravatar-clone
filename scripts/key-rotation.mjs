import { query, transaction, closeDatabase } from '../dist/packages/core/src/db.js';
import { encrypt, decrypt } from '../dist/packages/core/src/security.js';
import { config } from '../dist/packages/core/src/config.js';
const c = config();
if (
  !process.env.ROTATE_ENCRYPTION_KEY_ID ||
  process.env.ROTATE_ENCRYPTION_KEY_ID !== c.ENCRYPTION_KEY_ID
)
  throw new Error(
    'Set ROTATE_ENCRYPTION_KEY_ID to the deployed active key ID. Deploy the new active key plus previous and legacy keys on every service first.',
  );
let changed = 0;
try {
  await transaction(async (db) => {
    await query('SELECT pg_advisory_xact_lock(718208)', [], db);
    const columns = await query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('token_encrypted','private_encrypted','secret_encrypted','totp_secret','evidence_encrypted')",
      [],
      db,
    );
    for (const { table_name: table, column_name: column } of columns) {
      if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column))
        throw new Error('Unexpected encryption column');
      const rows = await query(
        'SELECT id,"' +
          column +
          '" AS encrypted FROM "' +
          table +
          '" WHERE "' +
          column +
          '" IS NOT NULL AND "' +
          column +
          '"<>$1 FOR UPDATE',
        [''],
        db,
      );
      for (const row of rows) {
        if (row.encrypted.startsWith('enc1:' + c.ENCRYPTION_KEY_ID + ':')) continue;
        await query(
          'UPDATE "' + table + '" SET "' + column + '"=$2 WHERE id=$1',
          [row.id, encrypt(decrypt(row.encrypted))],
          db,
        );
        changed++;
      }
    }
    for (const [table, column, fields] of [
      ['challenges', 'data', ['secret', 'verifier']],
      ['jobs', 'payload', ['tokenEncrypted']],
    ]) {
      const rows = await query(
        'SELECT id,"' +
          column +
          '" AS data FROM "' +
          table +
          '" WHERE "' +
          column +
          '" ?| $1::text[] FOR UPDATE',
        [fields],
        db,
      );
      for (const row of rows) {
        let update = false;
        for (const field of fields) {
          const value = row.data[field];
          if (
            typeof value === 'string' &&
            value &&
            !value.startsWith('enc1:' + c.ENCRYPTION_KEY_ID + ':')
          ) {
            row.data[field] = encrypt(decrypt(value));
            changed++;
            update = true;
          }
        }
        if (update)
          await query(
            'UPDATE "' + table + '" SET "' + column + '"=$2 WHERE id=$1',
            [row.id, JSON.stringify(row.data)],
            db,
          );
      }
    }
  });
  process.stdout.write(
    JSON.stringify({ status: 'rotated', keyId: c.ENCRYPTION_KEY_ID, values: changed }) + '\n',
  );
} finally {
  await closeDatabase();
}
