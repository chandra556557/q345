/**
 * Run Multi-Tenant Organization Migration
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres124112@localhost:5433/playwright_crx1?schema=public'
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Running multi-tenant organization migration...\n');

    // Read the SQL migration file
    const sqlPath = path.join(__dirname, 'playwright-crx-enhanced', 'backend', 'migrations', '010_create_organization_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute the migration
    await client.query(sql);

    console.log('\n✅ Migration completed successfully!');
    console.log('   - Organization table created');
    console.log('   - UserOrganization table created');
    console.log('   - OrganizationMember table created');
    console.log('   - Environment table created');
    console.log('   - Indexes and triggers created\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
