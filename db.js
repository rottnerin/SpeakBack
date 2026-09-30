const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL — set it to your Neon Postgres connection string in .env.");
}

// Uses Neon's HTTP driver (queries run over HTTPS, port 443) instead of the raw Postgres
// wire protocol on port 5432 — many school/corporate networks block outbound 5432.
const sql = neon(process.env.DATABASE_URL);

const ready = sql`
  CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    transcript TEXT NOT NULL,
    feedback TEXT NOT NULL
  )
`
  .then(() => sql`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS agreement JSONB`)
  .catch((err) => {
    console.error("Database setup failed — check DATABASE_URL:", err.message);
  });

async function insertSubmission({ studentName, studentClass, transcript, feedback, agreement }) {
  await ready;
  const rows = await sql`
    INSERT INTO submissions (student_name, student_class, transcript, feedback, agreement)
    VALUES (${studentName}, ${studentClass}, ${transcript}, ${feedback}, ${agreement || null})
    RETURNING id
  `;
  return rows[0].id;
}

async function listSubmissions() {
  await ready;
  return sql`
    SELECT id, student_name, student_class, created_at
    FROM submissions
    ORDER BY created_at DESC
  `;
}

async function getSubmission(id) {
  await ready;
  const rows = await sql`SELECT * FROM submissions WHERE id = ${id}`;
  return rows[0];
}

module.exports = { insertSubmission, listSubmissions, getSubmission };
