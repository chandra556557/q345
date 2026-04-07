const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const pool = new Pool({
      connectionString: 'postgresql://postgres:postgres124112@localhost:5433/playwright_crx1'
    });
    
    // Check User table structure
    const userColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'User' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('User table columns:');
    userColumns.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });
    
    // Create a test user
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // Generate a UUID for the user
    const uuid = require('crypto').randomUUID();
    
    const createUser = await pool.query(
      `INSERT INTO "User" (id, email, password, name, "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, NOW(), NOW()) 
       RETURNING id, email, name`,
      [uuid, 'karthik123@gmail.com', hashedPassword, 'Karthik']
    );
    
    console.log('User created successfully:');
    console.log(createUser.rows[0]);
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();