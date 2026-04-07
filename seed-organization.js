/**
 * Seed Organization for Testing Multi-Tenant Features
 * 
 * This creates:
 * 1. An organization for karthik123@gmail.com
 * 2. Sample members with different roles
 * 3. Sample environments (dev, staging, production)
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres124112@localhost:5433/playwright_crx1?schema=public'
});

async function seedOrganization() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Starting organization seeding...\n');

    // Get the existing user
    const userResult = await client.query(
      'SELECT * FROM "User" WHERE email = $1',
      ['karthik123@gmail.com']
    );
    
    if (userResult.rows.length === 0) {
      console.error('❌ User karthik123@gmail.com not found!');
      process.exit(1);
    }
    
    const user = userResult.rows[0];
    console.log('✅ Found user:', user.email);

    // Check if organization already exists
    const existingOrgResult = await client.query(
      'SELECT * FROM "Organization" WHERE slug = $1',
      ['demo-org']
    );
    
    let org;
    
    if (existingOrgResult.rows.length > 0) {
      org = existingOrgResult.rows[0];
      console.log('✅ Organization already exists:', org.name);
    } else {
      // Create organization
      const orgResult = await client.query(
        `INSERT INTO "Organization" (name, slug, subscription, "maxConcurrentRuns", "maxUsers", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING *`,
        ['Demo Organization', 'demo-org', 'enterprise', 10, 50]
      );
      org = orgResult.rows[0];
      console.log('✅ Created organization:', org.name);
    }

    // Check if user is already a member
    const existingMemberResult = await client.query(
      'SELECT * FROM "OrganizationMember" WHERE "userId" = $1 AND "organizationId" = $2',
      [user.id, org.id]
    );
    
    if (existingMemberResult.rows.length === 0) {
      // Add user as owner
      await client.query(
        `INSERT INTO "OrganizationMember" ("userId", "organizationId", role, "joinedAt")
         VALUES ($1, $2, $3, NOW())`,
        [user.id, org.id, 'owner']
      );
      console.log('✅ Added user as owner of organization');
    } else {
      console.log('✅ User is already a member');
    }

    // Create sample members (if they don't exist)
    const sampleMembers = [
      { name: 'John Developer', email: 'john@example.com', role: 'member' },
      { name: 'Sarah Admin', email: 'sarah@example.com', role: 'admin' },
      { name: 'Mike Viewer', email: 'mike@example.com', role: 'viewer' }
    ];

    for (const member of sampleMembers) {
      // Check if user exists
      let memberUserResult = await client.query(
        'SELECT * FROM "User" WHERE email = $1',
        [member.email]
      );
      
      let memberUser;
      
      if (memberUserResult.rows.length === 0) {
        // Create user with generated ID
        const userId = require('crypto').randomUUID();
        memberUserResult = await client.query(
          `INSERT INTO "User" (id, name, email, password, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING *`,
          [userId, member.name, member.email, '$2b$10$dummyHashForTestingOnly']
        );
        memberUser = memberUserResult.rows[0];
        console.log(`✅ Created user: ${memberUser.name}`);
      } else {
        memberUser = memberUserResult.rows[0];
      }

      // Check if already member
      const existingMemberCheck = await client.query(
        'SELECT * FROM "OrganizationMember" WHERE "userId" = $1 AND "organizationId" = $2',
        [memberUser.id, org.id]
      );
      
      if (existingMemberCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO "OrganizationMember" ("userId", "organizationId", role, "joinedAt")
           VALUES ($1, $2, $3, NOW())`,
          [memberUser.id, org.id, member.role]
        );
        console.log(`✅ Added ${memberUser.name} as ${member.role}`);
      }
    }

    // Create environments
    const environments = [
      { name: 'Development', type: 'development', config: { baseUrl: 'http://dev.example.com' } },
      { name: 'Staging', type: 'staging', config: { baseUrl: 'http://staging.example.com' } },
      { name: 'Production', type: 'production', config: { baseUrl: 'http://example.com' } }
    ];

    for (const env of environments) {
      const existingEnvResult = await client.query(
        'SELECT * FROM "Environment" WHERE name = $1 AND "organizationId" = $2',
        [env.name, org.id]
      );
      
      if (existingEnvResult.rows.length === 0) {
        await client.query(
          `INSERT INTO "Environment" (name, type, config, "organizationId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [env.name, env.type, JSON.stringify(env.config), org.id]
        );
        console.log(`✅ Created environment: ${env.name}`);
      } else {
        console.log(`✅ Environment already exists: ${env.name}`);
      }
    }

    console.log('\n🎉 Organization seeding complete!\n');
    console.log('📋 Summary:');
    console.log(`   Organization: ${org.name} (@${org.slug})`);
    console.log(`   Subscription: ${org.subscription}`);
    console.log(`   Max Concurrent Runs: ${org.maxConcurrentRuns}`);
    console.log(`   Max Users: ${org.maxUsers}`);
    console.log('\n🔐 You can now login with:');
    console.log('   Email: karthik123@gmail.com');
    console.log('   Password: password123');
    console.log('\n🏢 Navigate to Organizations in the dashboard to see multi-tenant features!');

  } catch (error) {
    console.error('❌ Error seeding organization:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedOrganization()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
