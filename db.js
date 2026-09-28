const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.resolve(__dirname, "data", "speakback.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    transcript TEXT NOT NULL,
    feedback TEXT NOT NULL
  )
`);

function insertSubmission({ studentName, studentClass, transcript, feedback }) {
  const stmt = db.prepare(`
    INSERT INTO submissions (student_name, student_class, transcript, feedback)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(studentName, studentClass, transcript, feedback);
  return Number(info.lastInsertRowid);
}

function listSubmissions() {
  return db
    .prepare(`
      SELECT id, student_name, student_class, created_at
      FROM submissions
      ORDER BY created_at DESC
    `)
    .all();
}

function getSubmission(id) {
  return db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
}

module.exports = { insertSubmission, listSubmissions, getSubmission };
