import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function getDbPool(): Pool {
  return pool;
}

export default pool;
