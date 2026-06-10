const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'telecom_gis',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  max: 20, // maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Expose helper to run a query
 */
const query = (text, params) => pool.query(text, params);

/**
 * Run a group of database actions inside a strict SQL Transaction (ACID).
 * If the callback throws any error, the transaction is immediately rolled back.
 * 
 * @param {Function} callback - Async function that takes a client and runs operations.
 *                              Example: const result = await db.transaction(async (client) => { ... })
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  transaction,
};
