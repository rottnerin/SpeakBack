require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");

const { gradeRecording } = require("./gemini");
const { insertSubmission, listSubmissions, getSubmission } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio files are allowed."));
    }
    cb(null, true);
  },
});

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ---------- Student submission flow ----------

app.post("/api/submit", upload.single("audio"), async (req, res) => {
  try {
    const studentName = (req.body.name || "").trim();
    const studentClass = (req.body.class || "").trim();

    if (!studentName || !studentClass) {
      return res.status(400).json({ error: "Name and class are required." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "An audio file is required." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
    }

    const { transcript, feedback } = await gradeRecording({
      audioBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
      studentName,
      studentClass,
    });
    // req.file.buffer is in-memory only and is discarded once this request ends —
    // the audio itself is never written to disk.

    const id = await insertSubmission({ studentName, studentClass, transcript, feedback });

    // Transcript is stored for teacher review in /admin but never sent to the student's
    // browser — only the feedback should reach them.
    res.json({ id, feedback });
  } catch (err) {
    console.error("Grading failed:", err);
    res.status(500).json({ error: "Something went wrong while grading your recording. Please try again." });
  }
});

// ---------- Admin auth ----------

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: "Not authenticated." });
}

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Invalid username or password." });
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/admin/api/session", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get("/admin/api/submissions", requireAdmin, async (req, res) => {
  try {
    res.json(await listSubmissions());
  } catch (err) {
    console.error("Failed to list submissions:", err);
    res.status(500).json({ error: "Failed to load submissions." });
  }
});

app.get("/admin/api/submissions/:id", requireAdmin, async (req, res) => {
  try {
    const submission = await getSubmission(Number(req.params.id));
    if (!submission) return res.status(404).json({ error: "Not found." });
    res.json(submission);
  } catch (err) {
    console.error("Failed to load submission:", err);
    res.status(500).json({ error: "Failed to load submission." });
  }
});

app.listen(PORT, () => {
  console.log(`SpeakBack running at http://localhost:${PORT}`);
});
