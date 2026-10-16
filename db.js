const { Firestore } = require("@google-cloud/firestore");

// Firestore (Google Cloud). On Cloud Run it uses the service account automatically.
// Locally: run `gcloud auth application-default login` once and set GOOGLE_CLOUD_PROJECT.
const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined });
const submissions = db.collection("submissions");

// Field names match the old Postgres columns so the admin page needs no changes.
function toRow(doc) {
  const d = doc.data();
  return { id: doc.id, ...d, created_at: d.created_at.toDate().toISOString() };
}

async function insertSubmission({ studentName, studentClass, theme, format, examinerName, formatFlag, transcript, feedback, agreement }) {
  const ref = await submissions.add({
    student_name: studentName,
    student_class: studentClass,
    theme: theme || null,
    format: format || "solo",
    examiner_name: examinerName || null,
    format_flag: formatFlag || null,
    created_at: Firestore.Timestamp.now(),
    transcript,
    feedback,
    agreement: agreement || null,
  });
  return ref.id;
}

async function listSubmissions() {
  const snap = await submissions
    .orderBy("created_at", "desc")
    .select("student_name", "student_class", "theme", "format", "format_flag", "created_at")
    .limit(1000)
    .get();
  return snap.docs.map(toRow);
}

async function getSubmission(id) {
  const doc = await submissions.doc(String(id)).get();
  return doc.exists ? toRow(doc) : undefined;
}

async function deleteSubmission(id) {
  const ref = submissions.doc(String(id));
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

// The hexagon button's "last run" figures. Kept in Firestore so they survive restarts and deploys
// (Cloud Run starts a fresh, empty instance each time).
const usageDoc = db.collection("meta").doc("last_usage");

async function saveLastUsage(usage) {
  await usageDoc.set(usage);
}

async function getLastUsage() {
  const doc = await usageDoc.get();
  return doc.exists ? doc.data() : null;
}

module.exports = { saveLastUsage, getLastUsage, insertSubmission, listSubmissions, getSubmission, deleteSubmission };
