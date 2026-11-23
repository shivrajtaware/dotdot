const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Prisma migration SQL files are ordered and contain no UTF-8 BOM', () => {
  const root = path.join(__dirname, '..', 'prisma', 'migrations');
  const migrations = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert.ok(migrations.length > 0);
  assert.deepEqual(migrations, [...migrations].sort());
  for (const name of migrations) {
    const sqlPath = path.join(root, name, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(sql.trim().length > 0, `${name} has SQL statements`);
    assert.notEqual(sql.charCodeAt(0), 0xfeff, `${name} must not begin with a UTF-8 BOM`);
  }
});

test('seed defaults preserve the Marathi register labels and readable season name', () => {
  const seed = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'seed.ts'), 'utf8');
  assert.match(seed, /const operational = \["[\u0900-\u097f]/u);
  assert.match(seed, /2026–27/u);
  assert.doesNotMatch(seed, /à¤|â€“/u);
});

test('historical register migration backfills immutable display snapshots', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261123000000_historical_register_snapshots', 'migration.sql'), 'utf8');
  for (const field of ['clerkNameSnapshot', 'assignedChemistNameSnapshot', 'shiftLabelSnapshot', 'shiftStartsAtSnapshot', 'shiftEndsAtSnapshot', 'shiftSortOrderSnapshot', 'employeeNameSnapshot', 'employeeRoleSnapshot']) {
    assert.match(sql, new RegExp(`ADD COLUMN "${field}"`), `${field} is stored for historical records`);
  }
  assert.match(sql, /"shiftLabelSnapshot" = shift\."label"/);
  assert.match(sql, /"employeeNameSnapshot" = employee\."name"/);
});

test('inventory movement migration links transactions to their production season', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261123010000_season_linked_inventory_movements', 'migration.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN "seasonId" TEXT/);
  assert.match(sql, /SET "seasonId" = record\."seasonId"/);
  assert.match(sql, /InventoryMovement_seasonId_productionDate_idx/);
  assert.match(sql, /InventoryMovement_seasonId_fkey/);
});

test('offline record migration adds a unique idempotency key', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261123020000_offline_record_idempotency', 'migration.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN "offlineId" TEXT/);
  assert.match(sql, /CREATE UNIQUE INDEX "ShiftRecord_offlineId_key"/);
});

test('correction decisions can be rejected with an audited resolution', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261123030000_correction_request_rejections', 'migration.sql'), 'utf8');
  for (const field of ['rejectedBy', 'rejectedAt', 'resolutionReason']) assert.match(sql, new RegExp(`ADD COLUMN "${field}"`));
});
