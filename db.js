const { Pool } = require("pg");

// Cloud Run reaches Cloud SQL over a unix socket at /cloudsql/<instance connection name>.
// Locally (or on any other host) set DATABASE_URL to a normal Postgres connection string,
// e.g. through the Cloud SQL Auth Proxy.
const config = process.env.INSTANCE_CONNECTION_NAME
  ? {
      host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "speakback",
    }
  : { connectionString: process.env.DATABASE_URL };

if (!process.env.INSTANCE_CONNECTION_NAME && !process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL (or INSTANCE_CONNECTION_NAME + DB_USER/DB_PASSWORD) — see .env.example.");
}

const pool = new Pool({ ...config, max: 5 });

const ready = pool
  .query(
    `CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      student_name TEXT NOT NULL,
      student_class TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      transcript TEXT NOT NULL,
      feedback TEXT NOT NULL
    )`
  )
  .then(() => pool.query("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS agreement JSONB"))
  .catch((err) => {
    console.error("Database setup failed — check the database settings:", err.message);
  });

async function insertSubmission({ studentName, studentClass, transcript, feedback, agreement }) {
  await ready;
  const { rows } = await pool.query(
    `INSERT INTO submissions (student_name, student_class, transcript, feedback, agreement)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [studentName, studentClass, transcript, feedback, agreement || null]
  );
  return rows[0].id;
}

async function listSubmissions() {
  await ready;
  const { rows } = await pool.query(
    `SELECT id, student_name, student_class, created_at
     FROM submissions
     ORDER BY created_at DESC`
  );
  return rows;
}

async function getSubmission(id) {
  await ready;
  const { rows } = await pool.query("SELECT * FROM submissions WHERE id = $1", [id]);
  return rows[0];
}

module.exports = { insertSubmission, listSubmissions, getSubmission };
