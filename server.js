require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");

const { gradeRecording, NoStudentSpeechError } = require("./gemini");
const { insertSubmission, listSubmissions, getSubmission } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini 3.8 Flash pricing (USD per token, introductory rate through 2026-12-31), used as an
// estimate for the cost display.
const PRICE_PER_INPUT_TOKEN = Number(process.env.GEMINI_PRICE_PER_INPUT_TOKEN || 0.75 / 1_000_000);
const PRICE_PER_OUTPUT_TOKEN = Number(process.env.GEMINI_PRICE_PER_OUTPUT_TOKEN || 3.75 / 1_000_000);

let lastRunUsage = null;

function costOf({ promptTokens, outputTokens }) {
  return promptTokens * PRICE_PER_INPUT_TOKEN + outputTokens * PRICE_PER_OUTPUT_TOKEN;
}

function recordUsage(usage) {
  const promptTokens = usage.promptTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  lastRunUsage = {
    promptTokens,
    outputTokens,
    totalTokens: usage.totalTokens || promptTokens + outputTokens,
    estimatedCostUsd: costOf({ promptTokens, outputTokens }),
    calls: (usage.calls || []).map((c) => ({ ...c, estimatedCostUsd: costOf(c) })),
    at: new Date().toISOString(),
  };
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

// Some browsers (notably Chrome on Windows) report no MIME type for HEIC/HEIF photos from an iPhone,
// so fall back to the file extension for those.
const HEIC_EXT = /\.(heic|heif)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "photo") {
      if (!file.mimetype.startsWith("image/") && !HEIC_EXT.test(file.originalname)) {
        return cb(new Error("The photo must be an image file (JPG, PNG, WebP or HEIC)."));
      }
    } else if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("The recording must be an audio file (MP3, M4A or WAV)."));
    }
    cb(null, true);
  },
});

const uploadFields = upload.fields([
  { name: "audio", maxCount: 1 },
  { name: "photo", maxCount: 1 },
]);

// Multer reports a bad upload (wrong type, too big) as an exception from the middleware itself, which
// would otherwise reach Express's default handler and come back as an HTML error page that the
// browser cannot parse. Turn it into the same JSON error shape the rest of the API uses.
function handleUpload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "That file is too large (the limit is 25MB)."
        : err.message || "The upload could not be read.";
    res.status(400).json({ error: message });
  });
}

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

app.post("/api/submit", handleUpload, async (req, res) => {
  try {
    const studentName = (req.body.name || "").trim();
    const audioFile = req.files && req.files.audio && req.files.audio[0];
    const photoFile = req.files && req.files.photo && req.files.photo[0];

    if (!studentName) {
      return res.status(400).json({ error: "Name is required." });
    }
    if (!audioFile) {
      return res.status(400).json({ error: "An audio file is required." });
    }
    if (photoFile && photoFile.size > MAX_PHOTO_BYTES) {
      return res.status(400).json({ error: "That photo is too large (the limit is 10MB). Try a smaller copy." });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
    }

    const { transcript, feedback, usage, agreement } = await gradeRecording({
      audioBuffer: audioFile.buffer,
      mimeType: audioFile.mimetype,
      studentName,
      photo: photoFile
        ? {
            buffer: photoFile.buffer,
            mimeType: photoFile.mimetype.startsWith("image/") ? photoFile.mimetype : "image/heic",
          }
        : null,
    });
    // The uploaded buffers are in-memory only and are discarded once this request ends —
    // neither the audio nor the photo is ever written to disk.

    recordUsage(usage);

    const id = await insertSubmission({
      studentName,
      studentClass: "",
      transcript,
      feedback,
      agreement,
    });

    // Transcript is stored for teacher review in /admin but never sent to the student's
    // browser — only the feedback should reach them.
    res.json({ id, feedback });
  } catch (err) {
    if (err instanceof NoStudentSpeechError) {
      // Nothing to grade, so nothing is saved for /admin; only the small transcription cost counts.
      recordUsage(err.usage);
      return res.status(422).json({
        code: err.code,
        error:
          "We couldn't hear you describing a photo in that recording. Please check that your " +
          "microphone was on and that you spoke about your photo for a few minutes, then upload it again.",
      });
    }
    console.error("Grading failed:", err);
    res.status(500).json({ error: "Something went wrong while grading your recording. Please try again." });
  }
});

// ---------- Admin auth ----------

app.get("/admin", (req, res) => res.redirect("/admin.html"));

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

app.get("/api/last-usage", (req, res) => {
  res.json({ usage: lastRunUsage });
});

app.listen(PORT, () => {
  console.log(`SpeakBack running at http://localhost:${PORT}`);
});
