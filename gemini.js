const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

// ---------- Shared helpers ----------

// Gemini sometimes returns markdown with the line breaks between blocks (headings, table rows,
// list items) collapsed, which makes marked.js render it as an unreadable wall of raw ##/|/- text.
// Re-insert the newlines the block-level markdown syntax requires.
function normalizeMarkdown(md) {
  return md
    .replace(/\s*(#{1,6}\s)/g, "\n\n$1") // headings start on their own line
    .replace(/\|\|/g, "|\n|") // adjacent table rows glued together at the "||" seam
    // Text running directly into a table's leading "|". The `-` and `:` exclusions keep a compact
    // separator row (|---|---|) intact — those dashes butt straight up against the next pipe.
    .replace(/([^\s\n|:-])\|/g, "$1\n|")
    .replace(/([^\s\n-])-(\s)/g, "$1\n-$2") // bullet items glued to the preceding sentence
    .replace(/([.\)])\s(\d+\.\s)/g, "$1\n$2") // numbered items glued to the preceding sentence
    .trim();
}

function readFeedbackRubric() {
  const rubricPath = path.resolve(__dirname, process.env.FEEDBACK_MD_PATH || "../feedback.md");
  return fs.readFileSync(rubricPath, "utf8");
}

function getModel(responseSchema) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0,
    },
  });
}

function usageOf(result) {
  const u = result.response.usageMetadata || {};
  return {
    promptTokens: u.promptTokenCount || 0,
    outputTokens: u.candidatesTokenCount || 0,
    totalTokens: u.totalTokenCount || 0,
  };
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.response.text());
  } catch (err) {
    throw new Error(`${label} returned a response that could not be parsed as JSON: ${err.message}`);
  }
}

const RUBRIC_PREAMBLE = `The text below, delimited by <<<FEEDBACK_MD>>> ... <<<END_FEEDBACK_MD>>>, is your complete grading
resource — it contains the required output structure, all four assessment criteria with band
descriptors, the raw-score-to-IB-grade conversion table, the taught "Describir la Foto" 3-part
framework and phrase banks, the grammar-trigger cheat sheet, and real examiner-derived band
differentiators grounded in previously graded student transcripts. Follow it exactly and in full —
do not substitute your own generic IB rubric knowledge or output format.`;

// ---------- Stage 1 + 3: criterion scoring (shared schema, two different evidence sources) ----------

const CRITERION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    evidence: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "2–4 direct verbatim quotes from the student, each paired with why it is decisive for " +
        "this criterion. Include both a strength and a limiting factor where the material allows.",
    },
    bandMatch: {
      type: SchemaType.STRING,
      description:
        "Which specific band-descriptor markers from feedback.md the evidence above satisfies or " +
        "fails, naming the marker language explicitly.",
    },
    borderline: {
      type: SchemaType.STRING,
      description:
        "If the score could plausibly go either way, the specific missing marker that would have " +
        "pushed it to the higher band. Empty string if the evidence clearly settles it.",
    },
    score: {
      type: SchemaType.NUMBER,
      description: "The sub-score, assigned as a consequence of the evidence and bandMatch above.",
    },
  },
  required: ["evidence", "bandMatch", "borderline", "score"],
};

// Only A and B1 appear here. This tool grades an unaccompanied monologue, so Criterion B2
// (conversation) and Criterion C (interaction) have no material to score — see MONOLOGUE_FORMAT.
const SCORES_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description:
        "A full, accurate Spanish transcript of what the student said, with brief [inaudible] " +
        "markers where genuinely unclear. Echo back the transcript you were given if given one.",
    },
    criterionA: CRITERION_SCHEMA,
    criterionB1: CRITERION_SCHEMA,
    subtotal: { type: SchemaType.NUMBER, description: "criterionA + criterionB1, out of 18." },
  },
  required: ["transcript", "criterionA", "criterionB1", "subtotal"],
};

// The real IB oral is three parts with an examiner. Students use this tool for the first part
// alone, so half the rubric has nothing to measure and the /30 band table cannot be applied.
const MONOLOGUE_FORMAT = `ASSESSMENT FORMAT — read this before applying feedback.md's output structure.

This recording is NOT a full IB Individual Oral. The student was shown a visual prompt and spoke
about it alone, uninterrupted, for roughly 3–5 minutes. There is no examiner, no questions, no
conversation and no dialogue of any kind.

Therefore you assess EXACTLY TWO criteria:
- Criterion A — Command of Language (1–12)
- Criterion B1 — Message: Visual Stimulus / Photo (1–6)

You do NOT assess, score, estimate, or speculate about:
- Criterion B2 — Message: Conversation. There is no conversation on this recording.
- Criterion C — Interaction. There is no interlocutor on this recording.

Never treat the absence of conversation or interaction as a weakness in the student's performance —
they were never asked to do those things. Do not deduct for it anywhere, and do not let it depress
Criterion A or B1. Never invent an examiner question or a student reply that is not on the tape.

Report a subtotal out of 18 (Criterion A /12 + Criterion B1 /6). Do NOT produce a total out of 30
and do NOT convert to an IB grade 1–7 — feedback.md's Raw Score → IB Grade table is calibrated for
the complete three-part exam and does not apply to a partial one. Applying it here would badly
understate the student.

Where feedback.md's required output structure refers to Partes 2 y 3, the conversation, interaction,
the /30 total or the grade conversion, omit those parts. Everything else in that structure — the
verbatim disclaimer, the score summary, the Parte 1 breakdown, strengths, the GROW corrections
table, evidence-based scoring, recommendations and the study-material check — still applies.`;

// Deliberately no "when on the fence, score lower" rule here. That tiebreak is applied once, by
// the judge — having it fire in both graders as well compounded it and pulled the upper bands down.
const EVIDENCE_FIRST_RULE = `For every criterion you must populate the fields in this order and mean it: cite the evidence
quotes FIRST, match them to named band-descriptor markers SECOND, and only then state the score as
the direct consequence of what you just cited. Never decide a score and backfill justification for
it. Score the performance as the evidence actually supports it — neither generous nor harsh. Where
the evidence genuinely sits between two bands, say so in the borderline field and pick the band the
quotes support best; do not shade your score in either direction as a hedge.`;

// These recordings frequently have the examiner's own spoken mark-up on them ("that's an 18, a
// solid 4"). Left unchecked the grader simply repeats the number it overheard, which looks like
// excellent accuracy on sample files and generalises to nothing.
const IGNORE_SPOKEN_GRADES = `CRITICAL: this recording may contain a teacher or examiner speaking about the student's
performance — stating a score, a band, a criterion mark, a total, or debating what to award. Any
such commentary is NOT evidence of the student's performance and must NOT influence your scoring in
any way. Do not adopt, anchor on, or be nudged by a number you hear. Score only the student's own
spoken Spanish, exactly as if the assessment commentary were not on the tape at all. If you notice
such commentary, ignore it silently and never mention or quote it.`;

// With no photo supplied the grader is judging a description of an image it cannot see, so it has
// no way to tell an accurate description from a confident invention — which is much of what B1 is.
function photoNote(hasPhoto) {
  return hasPhoto
    ? `The visual prompt the student was describing is attached as an image. Judge Criterion B1
against it directly: whether what they described is actually present, whether they moved beyond
listing visible objects into interpretation, and whether the cultural connection they drew is
genuinely supported by the image.`
    : `The visual prompt itself was NOT supplied, so you cannot verify that what the student
described is actually in the image. Judge Criterion B1 on the structure and language of the
description — the 3-part framework, interpretation beyond listing, whether a cultural connection is
developed or merely named — and do not penalise or reward accuracy of detail you cannot check.`;
}

function buildAudioGraderPrompt(studentName, hasPhoto) {
  return `You are an IB Spanish Ab Initio examiner assessing a student's spoken response to a visual
prompt. The student is ${studentName}.

${MONOLOGUE_FORMAT}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric()}
<<<END_FEEDBACK_MD>>>

You are listening to the ACTUAL AUDIO, not a transcript. Weigh what only the audio can tell you —
pronunciation, intonation, pacing, hesitation, false starts, and self-correction — alongside the
words themselves. feedback.md's Criterion A markers for these apply to what you HEAR.

${photoNote(hasPhoto)}

${IGNORE_SPOKEN_GRADES}

${EVIDENCE_FIRST_RULE}

Write every field in English except verbatim Spanish quotes of the student's own words and Spanish
grammar terms. The transcript field stays in Spanish, as spoken.

Return only the structured scoring JSON — no student-facing prose write-up at this stage.`;
}

function buildTranscriptGraderPrompt(studentName, transcript, hasPhoto) {
  return `You are an IB Spanish Ab Initio examiner assessing a student's spoken response to a visual
prompt. The student is ${studentName}.

${MONOLOGUE_FORMAT}

${photoNote(hasPhoto)}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric()}
<<<END_FEEDBACK_MD>>>

You are working from a TRANSCRIPT ONLY — you cannot hear the recording. The transcript is below,
delimited by <<<TRANSCRIPT>>> ... <<<END_TRANSCRIPT>>>.

<<<TRANSCRIPT>>>
${transcript}
<<<END_TRANSCRIPT>>>

Because you cannot hear delivery, judge ONLY what the words themselves evidence: vocabulary range,
grammatical accuracy, tense control, and how the description is built and developed. Do NOT guess at
pronunciation, intonation, or fluency — where a Criterion A band descriptor turns on something only
audible, say so in bandMatch and score the rest of the criterion on the textual evidence rather than
inventing an impression of how it sounded. Your Criterion B1 judgement, by contrast, rests on what
was said and is not limited this way.

${EVIDENCE_FIRST_RULE}

Echo the transcript you were given back in the transcript field, unchanged.

Return only the structured scoring JSON — no student-facing prose write-up at this stage.`;
}

const TRANSCRIPT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description:
        "A full, accurate, verbatim Spanish transcript of everything the student said. Preserve " +
        "errors exactly as spoken (do not silently correct the student's grammar). Mark unclear " +
        "stretches [inaudible].",
    },
  },
  required: ["transcript"],
};

// ---------- Stage 4: judge ----------

const JUDGE_CRITERION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    reconciliation: {
      type: SchemaType.STRING,
      description:
        "Why the two graders agreed or differed on this criterion, and which evidence you found " +
        "more credible. Name the audible-only factors if they explain the gap.",
    },
    score: { type: SchemaType.NUMBER, description: "The final reconciled sub-score." },
  },
  required: ["reconciliation", "score"],
};

const JUDGE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    criterionA: JUDGE_CRITERION_SCHEMA,
    criterionB1: JUDGE_CRITERION_SCHEMA,
    subtotal: {
      type: SchemaType.NUMBER,
      description: "criterionA + criterionB1, out of 18. Not a /30 total and not an IB grade.",
    },
    feedback: {
      type: SchemaType.STRING,
      description:
        "The complete student-facing assessment in Markdown, following feedback.md's 'Required " +
        "output structure' section in order, using its exact disclaimer text verbatim, reporting " +
        "the final reconciled scores above, and stating plainly that Conversation and Interaction " +
        "are not assessed in this practice format.",
    },
  },
  required: ["criterionA", "criterionB1", "subtotal", "feedback"],
};

function buildJudgePrompt(studentName, transcript, audioGrade, transcriptGrade) {
  return `You are the senior moderating examiner for an IB Spanish Ab Initio oral practice task. The student
is ${studentName}.

Two independent examiners have already scored this same performance and you must reconcile them
into one final set of scores, then write the student-facing feedback.

${MONOLOGUE_FORMAT}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric()}
<<<END_FEEDBACK_MD>>>

The transcript of what the student actually said:

<<<TRANSCRIPT>>>
${transcript}
<<<END_TRANSCRIPT>>>

EXAMINER 1 graded from the ACTUAL AUDIO and could hear pronunciation, intonation, pacing,
hesitation and self-correction:

<<<AUDIO_EXAMINER>>>
${JSON.stringify(audioGrade, null, 2)}
<<<END_AUDIO_EXAMINER>>>

EXAMINER 2 graded from the TRANSCRIPT ONLY and could not hear anything — their view of wording and
grammar is uncontaminated by how confident or fluent the student sounded:

<<<TRANSCRIPT_EXAMINER>>>
${JSON.stringify(transcriptGrade, null, 2)}
<<<END_TRANSCRIPT_EXAMINER>>>

How to reconcile, per criterion:
- Where both examiners agree, keep that score.
- **Criterion A and Criterion C: take Examiner 1's score.** Both criteria turn on things only the
  audio carries — pronunciation, intonation, hesitation, repair, sustained participation — and
  Examiner 2 could not hear any of it, so a lower mark from Examiner 2 here reflects deafness to the
  evidence, not a stricter reading of it. Depart from Examiner 1's score on A or C ONLY when
  Examiner 1's own cited quotes contradict the score it assigned (for example, quotes showing
  repeated breakdown paired with a high band). Examiner 2 being lower is not by itself a reason.
- **Criterion B1 and B2: weigh the quotes, and lean on Examiner 2 where they conflict.** These turn
  on what was actually SAID — message content, development, relevance, cultural connection — which
  is fully visible in the transcript. A disagreement here usually means Examiner 1 was swayed by
  delivery: confident-sounding delivery must not inflate a thin message, and hesitant delivery must
  not deflate a substantive one.
- A wide gap (2+ points) means one examiner cited weak evidence. Go back to the quotes themselves
  and favour the examiner whose quotes actually demonstrate the band marker claimed.
- Only when the reconciled evidence leaves you genuinely on the fence between two adjacent scores,
  and the quotes truly do not settle it, take the LOWER of the two. This is a last-resort tiebreak
  for a real coin-flip, not a general instruction to grade conservatively — do not apply it to a
  call the evidence does settle, and do not stack it on top of a score you already reasoned down.
- Your subtotal is Criterion A + Criterion B1, out of 18. Do not produce a /30 total and do not
  convert to an IB grade 1–7.

Then write the full student-facing feedback in Markdown, following feedback.md's 'Required output
structure' in order but omitting everything that refers to the conversation, the interaction, the
/30 total or the grade conversion. Report YOUR final reconciled scores (not either examiner's).

In the Score Summary table, list only Criterion A and Criterion B1 with their scores and achievement
levels, then a subtotal row of X/18. Immediately after that table, state plainly and in a
non-discouraging way that Criterion B2 (Conversation) and Criterion C (Interaction) are not assessed
in this practice format because there is no examiner dialogue to assess, that they carry the
remaining 12 marks in the real exam, and that no IB grade 1–7 is given here for that reason.

Ground every claim in a quoted moment, drawing on the evidence both examiners cited. Never mention
the two examiners, the reconciliation process, or that multiple passes happened — to the student
this is simply their assessment.

Write the feedback in English throughout. The only Spanish allowed is verbatim quotes of the
student's own words and Spanish grammar terms.

The feedback field must be valid Markdown with real newline characters separating every block
element — a blank line before and after each heading, each table, and each list, and each table row
on its own line. Do not run headings, tables, or list items together on a single line.`;
}

// ---------- Pipeline stages ----------

function photoPart(photo) {
  return photo ? [{ inlineData: { mimeType: photo.mimeType, data: photo.buffer.toString("base64") } }] : [];
}

async function gradeFromAudio({ audioBuffer, mimeType, studentName, photo }) {
  const result = await getModel(SCORES_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    ...photoPart(photo),
    { text: buildAudioGraderPrompt(studentName, !!photo) },
  ]);
  return { grade: parseJson(result, "The audio grader"), usage: usageOf(result) };
}

async function transcribeAudio({ audioBuffer, mimeType }) {
  const result = await getModel(TRANSCRIPT_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    {
      text:
        "Transcribe this recording of a student speaking Spanish about a visual prompt. Produce a " +
        "faithful, verbatim Spanish transcript of everything the student says, start to finish. " +
        "Preserve the student's errors exactly as spoken — do not correct grammar, agreement, or " +
        "tense. Mark genuinely unclear stretches [inaudible]. Do not assess or comment on the " +
        "performance.\n\n" +
        "If a teacher or examiner speaks at any point — asking a question, or discussing the " +
        "student's performance, a score, a band or a mark — exclude all of it and transcribe only " +
        "the student's own speech. Never carry a spoken score or band into the transcript.",
    },
  ]);
  return { transcript: parseJson(result, "The transcriber").transcript, usage: usageOf(result) };
}

async function gradeFromTranscript({ transcript, studentName, photo }) {
  const result = await getModel(SCORES_SCHEMA).generateContent([
    ...photoPart(photo),
    { text: buildTranscriptGraderPrompt(studentName, transcript, !!photo) },
  ]);
  return { grade: parseJson(result, "The transcript grader"), usage: usageOf(result) };
}

async function judgeGrades({ studentName, transcript, audioGrade, transcriptGrade }) {
  const result = await getModel(JUDGE_SCHEMA).generateContent(
    buildJudgePrompt(studentName, transcript, audioGrade, transcriptGrade)
  );
  return { verdict: parseJson(result, "The judge"), usage: usageOf(result) };
}

// ---------- Orchestration ----------

function sumUsage(entries) {
  const total = entries.reduce(
    (acc, e) => ({
      promptTokens: acc.promptTokens + e.usage.promptTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      totalTokens: acc.totalTokens + e.usage.totalTokens,
    }),
    { promptTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
  return { ...total, calls: entries.map((e) => ({ stage: e.stage, ...e.usage })) };
}

function scoresOf(grade) {
  return {
    A: grade.criterionA.score,
    B1: grade.criterionB1.score,
    total: grade.subtotal,
  };
}

async function gradeRecording({ audioBuffer, mimeType, studentName, photo }) {
  // The audio grader and the transcriber both need the audio, so they run concurrently; the
  // transcript grader then works from a source the audio grader never saw, which is what makes
  // the two verdicts an actual cross-check rather than the same call run twice.
  const [audio, transcription] = await Promise.all([
    gradeFromAudio({ audioBuffer, mimeType, studentName, photo }),
    transcribeAudio({ audioBuffer, mimeType }),
  ]);

  const text = await gradeFromTranscript({
    transcript: transcription.transcript,
    studentName,
    photo,
  });

  const judged = await judgeGrades({
    studentName,
    transcript: transcription.transcript,
    audioGrade: audio.grade,
    transcriptGrade: text.grade,
  });

  const usage = sumUsage([
    { stage: "audio-grader", usage: audio.usage },
    { stage: "transcriber", usage: transcription.usage },
    { stage: "transcript-grader", usage: text.usage },
    { stage: "judge", usage: judged.usage },
  ]);

  return {
    transcript: transcription.transcript.trim(),
    feedback: normalizeMarkdown(judged.verdict.feedback.trim()),
    usage,
    // Kept for the teacher-facing admin view: how far apart the two independent graders were
    // before reconciliation is the signal for "this one is worth a human look".
    agreement: {
      audio: scoresOf(audio.grade),
      transcript: scoresOf(text.grade),
      final: {
        A: judged.verdict.criterionA.score,
        B1: judged.verdict.criterionB1.score,
        total: judged.verdict.subtotal,
      },
    },
  };
}

module.exports = { gradeRecording };
