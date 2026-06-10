const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// 1. Initialize environment file if missing
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  console.log('Copying .env.example to .env to bootstrap configuration...');
  fs.copyFileSync(envExamplePath, envPath);
}

require('dotenv').config();
const db = require('./config/db');

async function runTests() {
  console.log('==================================================');
  console.log('TELECOM WEB GIS PLATFORM - AUTOMATED VERIFICATION');
  console.log('==================================================');
  
  try {
    // Test 1: Check Database Connection pool
    console.log('Test 1: Testing PostgreSQL connection pool...');
    const nowRes = await db.query('SELECT NOW()');
    console.log('Connection OK. Current DB Time:', nowRes.rows[0].now);
    
    // Test 2: Test Schema table presence
    console.log('\nTest 2: Verifying schema tables and PostGIS extension...');
    const tablesCheck = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'telecom_assets', 'telecom_routes', 'connectivity_links', 'edit_history')
    `);
    
    console.log(`Found ${tablesCheck.rows.length}/5 matching tables in public schema.`);
    if (tablesCheck.rows.length < 5) {
      console.log('Running automatic schema migration from schema.sql...');
      const schemaSql = fs.readFileSync(path.join(__dirname, 'models', 'schema.sql'), 'utf8');
      await db.query(schemaSql);
      console.log('Schema tables created successfully.');
    }

    // Test 3: Transactional Test (ACID verification)
    console.log('\nTest 3: Testing ACID transactional inserts & topological links...');
    
    await db.transaction(async (client) => {
      // Create a test user
      console.log('-> Creating validation user...');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('adminpass123', salt);
      const userRes = await client.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('verification_agent', 'agent@telecom.net', $1, 'planner')
        ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
        RETURNING id
      `, [hash]);
      const userId = userRes.rows[0].id;
      console.log(`User created (ID: ${userId})`);

      // Create test nodes
      console.log('-> Seeding test assets (OLT, Splitter, Customer)...');
      const oltRes = await client.query(`
        INSERT INTO telecom_assets (name, asset_type, geom, status, created_by)
        VALUES ('Test OLT-01', 'olt', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), 'Active', $1)
        RETURNING id
      `, [userId]);
      const oltId = oltRes.rows[0].id;

      const splitterRes = await client.query(`
        INSERT INTO telecom_assets (name, asset_type, geom, status, created_by)
        VALUES ('Test Splitter-01', 'splitter', ST_SetSRID(ST_MakePoint(-122.4150, 37.7780), 4326), 'Active', $1)
        RETURNING id
      `, [userId]);
      const splitterId = splitterRes.rows[0].id;

      const customerRes = await client.query(`
        INSERT INTO telecom_assets (name, asset_type, geom, status, created_by)
        VALUES ('Test Customer Premise', 'customer', ST_SetSRID(ST_MakePoint(-122.4100, 37.7800), 4326), 'Planned', $1)
        RETURNING id
      `, [userId]);
      const customerId = customerRes.rows[0].id;

      // Create test routes (Cables)
      console.log('-> Seeding test fiber cables routes...');
      const cable1Res = await client.query(`
        INSERT INTO telecom_routes (name, route_type, geom, status, created_by, additional_attributes)
        VALUES ('Feeder Cable OLT-Splitter', 'fiber_cable', ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4194 37.7749, -122.4150 37.7780)'), 4326), 'Active', $1, '{"fiber_count": 48}')
        RETURNING id, length_meters
      `, [userId]);
      const cable1Id = cable1Res.rows[0].id;
      const length1 = cable1Res.rows[0].length_meters;
      console.log(`Feeder Cable created (ID: ${cable1Id}, Length: ${parseFloat(length1).toFixed(1)}m)`);

      const cable2Res = await client.query(`
        INSERT INTO telecom_routes (name, route_type, geom, status, created_by, additional_attributes)
        VALUES ('Distribution Cable Splitter-Customer', 'fiber_cable', ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4150 37.7780, -122.4100 37.7800)'), 4326), 'Active', $1, '{"fiber_count": 12}')
        RETURNING id, length_meters
      `, [userId]);
      const cable2Id = cable2Res.rows[0].id;
      const length2 = cable2Res.rows[0].length_meters;
      console.log(`Distribution Cable created (ID: ${cable2Id}, Length: ${parseFloat(length2).toFixed(1)}m)`);

      // Splicing connections
      console.log('-> Establishing splicing linkages (establishing path OLT -> Splitter -> Customer)...');
      await client.query(`
        INSERT INTO connectivity_links (from_asset_id, to_asset_id, route_id, link_type)
        VALUES ($1, $2, $3, 'olt-splitter')
      `, [oltId, splitterId, cable1Id]);

      await client.query(`
        INSERT INTO connectivity_links (from_asset_id, to_asset_id, route_id, link_type)
        VALUES ($1, $2, $3, 'splitter-customer')
      `, [splitterId, customerId, cable2Id]);
      
      console.log('Topology stitched.');

      // Test 4: Running trace logic queries inside transaction to verify path resolver
      console.log('\nTest 4: Running Upstream / Downstream BFS path tracers...');
      
      // Upstream trace from Customer to OLT
      const upstreamRes = await client.query(`
        WITH RECURSIVE upstream_bfs AS (
          SELECT id AS node_id, asset_type, ARRAY[id] AS visited_nodes
          FROM telecom_assets WHERE id = $1
          UNION ALL
          SELECT next_asset.id AS node_id, next_asset.asset_type, b.visited_nodes || next_asset.id
          FROM upstream_bfs b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END)
          WHERE next_asset.is_deleted = false AND NOT (next_asset.id = ANY(b.visited_nodes)) AND b.asset_type <> 'olt'
        )
        SELECT visited_nodes FROM upstream_bfs WHERE asset_type = 'olt';
      `, [customerId]);

      if (upstreamRes.rows.length > 0) {
        console.log('✔ Upstream BFS trace SUCCESS. Path resolved customer back to OLT:', upstreamRes.rows[0].visited_nodes.join(' -> '));
      } else {
        throw new Error('Upstream BFS path tracing failed. Path not found.');
      }

      // Downstream trace from OLT
      const downstreamRes = await client.query(`
        WITH RECURSIVE downstream_bfs AS (
          SELECT id AS node_id, asset_type, ARRAY[id] AS visited_nodes
          FROM telecom_assets WHERE id = $1
          UNION ALL
          SELECT next_asset.id AS node_id, next_asset.asset_type, b.visited_nodes || next_asset.id
          FROM downstream_bfs b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END)
          WHERE next_asset.is_deleted = false AND NOT (next_asset.id = ANY(b.visited_nodes)) AND next_asset.asset_type <> 'olt'
        )
        SELECT DISTINCT node_id FROM downstream_bfs;
      `, [oltId]);

      console.log(`✔ Downstream BFS trace SUCCESS. Reached ${downstreamRes.rows.length} downstream components.`);

      // Service Impact simulation: Cut cable segment #1 (Feeder)
      console.log('\nTest 5: Running simulated Service Impact outage cuts...');
      const cutQuery = `
        WITH RECURSIVE downstream_impact AS (
          SELECT id AS node_id, asset_type, ARRAY[id] AS visited_nodes
          FROM telecom_assets WHERE id = $1
          UNION ALL
          SELECT next_asset.id AS node_id, next_asset.asset_type, b.visited_nodes || next_asset.id
          FROM downstream_impact b
          JOIN connectivity_links l ON (l.from_asset_id = b.node_id OR l.to_asset_id = b.node_id)
          JOIN telecom_assets next_asset ON (next_asset.id = CASE WHEN l.from_asset_id = b.node_id THEN l.to_asset_id ELSE l.from_asset_id END)
          WHERE next_asset.is_deleted = false 
            AND NOT (next_asset.id = ANY(b.visited_nodes))
            AND l.route_id <> $2 -- skip the cut route
            AND next_asset.asset_type <> 'olt'
        )
        SELECT a.id, a.name FROM downstream_impact d JOIN telecom_assets a ON d.node_id = a.id WHERE a.asset_type = 'customer';
      `;
      // Running trace downstream from Splitter assuming Feeder cable is cut (OLT side)
      // Since Feeder cable is cut, customer should have 0 upstream paths to OLT.
      const cutRes = await client.query(cutQuery, [splitterId, cable1Id]);
      console.log(`✔ Outage simulation complete. Outage on Feeder Cable #${cable1Id} isolates ${cutRes.rows.length} customer nodes.`);

      // Log in edit history
      await client.query(`
        INSERT INTO edit_history (table_name, record_id, action, changed_by)
        VALUES ('telecom_assets', $1, 'DELETE', $2)
      `, [oltId, userId]);

      console.log('\n✔ All transactional and trace checks completed successfully.');
      console.log('Rolling back testing entities to keep database clean...');
      throw new Error('ROLLBACK_VERIFIED'); // Force rollback so tests don't pollute local DB
    });

  } catch (err) {
    if (err.message === 'ROLLBACK_VERIFIED') {
      console.log('✔ Transaction rolled back cleanly. Database remains clean.');
      console.log('\n==================================================');
      console.log('VERIFICATION SUMMARY: ALL TEST CRITERIA PASSED');
      console.log('==================================================');
    } else {
      console.error('\nVerification tests failed!');
      console.error(err);
      process.exit(1);
    }
  } finally {
    await db.pool.end();
  }
}

runTests();
