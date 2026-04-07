const { Pool } = require('pg');

(async () => {
  try {
    const pool = new Pool({
      connectionString: 'postgresql://postgres:postgres124112@localhost:5433/playwright_crx1'
    });
    
    // Check existing tables
    const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Existing tables:', tablesRes.rows.map(r => r.table_name));
    
    // Check if users table exists
    const usersExist = tablesRes.rows.some(row => row.table_name === 'users');
    console.log('Users table exists:', usersExist);
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();