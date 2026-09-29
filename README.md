# SpeakBack

IB Spanish Ab Initio Individual Oral practice feedback — students upload a recording of
themselves doing the photo description + conversation, and get back an examiner-style
transcript and rubric-based assessment, generated against a teacher-calibrated rubric.

**Live:** https://speakback.onrender.com

![SpeakBack upload form](docs/screenshot.png)

## How it works

1. A student enters their name and class, and uploads an audio recording (MP3/M4A/WAV, up
   to 25MB) of their oral practice.
2. The audio is sent straight to Gemini along with `feedback.md` — the full grading rubric,
   calibrated against real teacher-graded transcripts — and graded in one pass. The audio
   itself is never written to disk; it only lives in memory for the duration of the request.
3. The student gets back:
   - A full Spanish transcript of their spoken turns.
   - Strengths and successes, with specific examples.
   - Targeted corrections (error → why → correction).
   - Rubric-based scoring per criterion (A, B1, B2, C), with a total /30 and IB grade band.
   - Actionable, prioritized recommendations tied to their actual gaps.
   - A check for use of the taught phrase banks / "Describir la Foto" framework.
4. Every submission (transcript + feedback) is saved to Postgres so teachers can review
   student history from an admin dashboard.

> This tool is for practice only — it does not represent or influence a student's official
> teacher-assigned grade.

## Stack

- **Server:** Node.js + Express, audio handled in-memory via Multer (never persisted to disk)
- **Grading:** Google Gemini (`@google/generative-ai`), audio input + structured JSON output
- **Database:** Neon serverless Postgres (HTTP driver, so it works on networks that block
  the raw Postgres port)
- **Frontend:** static HTML/CSS/JS in `public/`
- **Hosting:** Render

## Running locally

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY, DATABASE_URL, etc.
npm start
```

The app runs at `http://localhost:3000`. Admin dashboard is at `/admin`, gated by
`ADMIN_USER` / `ADMIN_PASSWORD` from `.env`.

### Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Gemini model used for grading (must support audio input) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login for `/admin` |
| `SESSION_SECRET` | Signs the admin session cookie |
| `FEEDBACK_MD_PATH` | Path to the grading rubric (read fresh on every request) |
| `DATABASE_URL` | Neon Postgres connection string |
| `PORT` | Server port (default 3000) |

## The rubric

`feedback.md` is the actual grading logic — it's sent to the model with every submission,
not baked into the code. It contains the four IB assessment criteria with band descriptors,
real examiner-derived differentiators calibrated against previously graded transcripts, the
raw-score-to-IB-grade conversion table, and the phrase banks / frameworks taught in class.
Updating the rubric (tone, scoring strictness, what counts as evidence) is a matter of
editing that file — no code changes or redeploy of application logic required.
