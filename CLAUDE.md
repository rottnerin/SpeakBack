# SpeakBack — project guide for Claude

IB Spanish Ab Initio oral practice tool. A student uploads an audio recording of themselves
describing a photo, plus (optionally) the photo. Gemini grades it against a teacher-calibrated
rubric and returns student-facing feedback. The teacher reviews submissions in `/admin`.
Node/Express app, Neon Postgres, deployed on Render (https://speakback.onrender.com).

## The format being graded (do not drift from this)

- Students submit **only the one-way photo description** (~3–5 min, solo). **No examiner, no
  conversation.** This is Part 1 of the real oral only.
- We score **Criterion A (/12) + Criterion B1 (/6) = subtotal /18**.
- **Criterion B2 (Conversation) and C (Interaction) are NOT assessed.** Never deduct for their
  absence, never invent an examiner question, never produce a /30 total, never convert to an IB
  grade 1–7 (the grade table is calibrated for the full exam and would badly understate students).
- **Students see marks, never bands.** Marks for A (/12), B1 (/6) and the subtotal (/18) only. No
  "Band 5"/"Level 6"/band ranges anywhere in student-facing text, and no mention of B2, C, the other
  12 marks or the full exam. Bands are internal scoring machinery (graders and judge use them to
  reach marks); targets are expressed in marks ("B1 3/6 → 5/6").
- Student-facing feedback is **English**; only the student's own quoted Spanish and Spanish grammar
  terms are Spanish. Tone: encouraging, constructive, rubric-grounded, every claim quoted.

## Decisions already made (don't re-ask)

- **Photo is optional.** With no photo, B1 is judged on structure/language only; accuracy of detail
  is neither rewarded nor penalised.
- **Photo analysis is internal only.** There is no standalone "Photo check" section in the student
  feedback. Accuracy against the image may appear only inside the Photo Description Breakdown and
  B1 scoring when it affects the score.
- **Audio and photo are never stored** — in-memory only for the request (multer memoryStorage).
  Photos may show people. Only the transcript + feedback + score agreement go to Postgres.
- The transcript is stored for teacher review in `/admin` but is **never sent to the student's
  browser**.
- Don't soften the evidence-first scoring rules or the cultural-connection cap (B1 max 4/6 without a developed link) in
  `feedback.md`; they come from real teacher commentary.

## Files

| File | Role |
|---|---|
| `feedback.md` | **The grading logic (v2, solo photo description).** Read fresh from disk on every request via `FEEDBACK_MD_PATH` — edit it, no redeploy of logic. Sent in 3 of the pipeline's calls. |
| `feedback-full-exam.md` | Archived v1 rubric for the full 3-part oral (A/B1/B2/C, /30). **Not loaded at runtime.** Source for any future full-exam mode. |
| `gemini.js` | The grading pipeline and all prompts/schemas. |
| `server.js` | Express routes, upload validation, admin auth, usage/cost tracking. |
| `db.js` | Neon (HTTP driver, so school networks blocking :5432 still work). |
| `public/` | Static frontend: `index.html`, `app.js` (upload form, photo dropzone, falling-bubble vocabulary game during the wait), `admin.*`, `style.css`. |
| `design.md` | Original Hexly design-system reference (historical). **The live site uses the UNIS Hanoi palette**, set as CSS tokens at the top of `public/style.css`: `--brand` #004b98 (blue), `--burgundy` #8e1738, `--honey` #ed7004, cooler grey `--bone` #F2F5F7; dark mode swaps in a lighter blue (`--brand` #2977bc, `--link` #7fb2ea) so buttons and link text stay readable. Change colours by editing the tokens, not individual rules. |

## Grading pipeline (`gradeRecording` in `gemini.js`)

1. **Photo analysis** (only if a photo was sent) — image alone → structured JSON reference reading
   (scene, key elements, visible text, cultural indicators, ambiguous, not-determinable). Runs in
   parallel with transcription. If it fails, grading continues without it (image still attached).
2. **Transcribe** — verbatim Spanish, student speech only (examiner/teacher speech excluded).
   **No-speech gate:** the transcriber also returns `hasStudentSpeech`. If it is false, or the
   transcript has under `MIN_STUDENT_WORDS` (30) real words, `gradeRecording` throws
   `NoStudentSpeechError` — the server returns HTTP 422 with a "please re-record" message, skips
   grading, **does not save to Postgres**, and records only the transcription cost.
3. **Audio grader** (hears the audio) and **transcript grader** (text only, cannot hear) run in
   parallel, each scoring A and B1 evidence-first.
4. **Judge** — reconciles: take the audio grader on **A** (delivery is audible-only); lean on the
   transcript grader on **B1** (content is fully in the text), settled by checking claims against the
   photo; tiebreak to the lower score only on a true coin-flip. Writes the student feedback.
- Sample recordings often contain the teacher's spoken scores. Prompts tell the model to ignore
  them (`IGNORE_SPOKEN_GRADES`) — otherwise it just repeats the number it overheard.
- `temperature: 0`, JSON responseSchema everywhere. `normalizeMarkdown` repairs Gemini's collapsed
  line breaks so `marked.js` renders properly.
- Per-stage token usage/cost is tracked in memory (`/api/last-usage`, the hex button in the UI).

## Running and checking

```bash
npm install
cp .env.example .env      # GEMINI_API_KEY, GEMINI_MODEL, DATABASE_URL, ADMIN_*, SESSION_SECRET
npm start                 # http://localhost:3000, admin at /admin
node --check gemini.js server.js public/app.js
```

- There is no test suite. Verify uploads with `curl -F name=T -F audio=@f\;type=audio/mpeg
  localhost:PORT/api/submit`; bad uploads must return JSON `{error}` (see `handleUpload`).
- Live Gemini calls cost real money and send content to Google. Don't run student recordings
  through it casually; a synthetic image is enough to check a schema.
- Never print or commit `.env`.

## Known gaps / open items

- **PDF download** now uses the browser's print dialog (`window.print()` in `public/app.js`, "Save as PDF"). The
  `@media print` block at the bottom of `public/style.css` hides everything except `#result`. Text is selectable and
  wrapped lines render cleanly. html2pdf.js was removed. Not yet tried on Safari/mobile.
- **Admin password** is the owner's to-do: set `ADMIN_USER` and `ADMIN_PASSWORD` in Render's environment variables
  (a long passphrase, since the repo is public). The code reads them in `server.js`; nothing to change there.

- **Calibration of v2 is partly untested.** The Criterion A/B1 descriptors transfer from the 55
  full-exam transcripts, but the "performance-level differentiators" were adapted to a monologue,
  and the photo-accuracy markers are new (the source transcripts had no photo). Validate on a few
  real monologue submissions with the teacher before trusting the bands.
- `README.md` references `docs/screenshot.png`, which went missing from the working tree
  (tracked in git: `git restore docs/screenshot.png`).
- Gemini inline-data request limits may be tighter than the 25MB audio cap; large audio + photo
  could fail. Unverified.

## Working with the owner

- The owner is a teacher/builder, not a full-time engineer: explain tradeoffs plainly, lead with the
  recommendation, and ask only for decisions that are really theirs.
- Plan together before changing grading behaviour; the rubric is the product.
- Commits only when asked. Don't touch `.env`, and don't delete the archived rubric.
