const { Pool } = require('pg');

(async () => {
  try {
    const pool = new Pool({
      connectionString: 'postgresql://postgres:postgres124112@localhost:5433/playwright_crx1'
    });
    
    const res = await pool.query('SELECT id, email, password, name FROM "User" WHERE email = $1', ['karthik123@gmail.com']);
    console.log('User data:', res.rows[0]);
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();