// Additive, production-safe migration: add soft-delete columns to Warehouse/Rack/Slot.
// IF NOT EXISTS guards make it idempotent. Backup taken first. SELECT/ALTER only — no data deletion.
const fs = require('fs');
const path = require('path');
const e = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = e.match(/DIRECT_URL\s*=\s*"?([^"\n\r]+)/)[1];
const { Client } = require('pg');
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await c.connect();
    // ── Backup ──
    const dump = {};
    for (const t of ['Warehouse', 'Rack', 'Slot']) dump[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
    const dir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `softdelete-premigration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(dump, null, 2));

    // ── Additive columns ──
    const report = {};
    for (const t of ['Warehouse', 'Rack', 'Slot']) {
      await c.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false`);
      await c.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`);
      await c.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT`);
      const cols = (await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name IN ('isDeleted','deletedAt','deletedBy') ORDER BY column_name`, [t]
      )).rows.map(r => r.column_name);
      report[t] = { rows: dump[t].length, columnsPresent: cols };
    }
    console.log('BACKUP_FILE', file);
    console.log('MIGRATION_OK', JSON.stringify(report, null, 2));
  } catch (err) { console.error('MIGRATION_FAILED', err.message); process.exit(1); }
  finally { await c.end(); }
})();
