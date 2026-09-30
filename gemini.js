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
    .replace(/([^\s\n|])\|/g, "$1\n|") // text running directly into a table's leading "|"
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

const SCORES_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description:
        "A full, accurate Spanish transcript of the student's spoken turns only — not the " +
        "examiner's questions unless needed for context. Include brief [inaudible] markers where " +
        "genuinely unclear. Echo back the transcript you were given if you were given one.",
    },
    criterionA: CRITERION_SCHEMA,
    criterionB1: CRITERION_SCHEMA,
    criterionB2: CRITERION_SCHEMA,
    criterionC: CRITERION_SCHEMA,
    totalScore: { type: SchemaType.NUMBER, description: "Sum of the four sub-scores, out of 30." },
    ibGrade: {
      type: SchemaType.NUMBER,
      description: "IB grade 1–7, via feedback.md's Raw Score → IB Grade conversion table.",
    },
  },
  required: ["transcript", "criterionA", "criterionB1", "criterionB2", "criterionC", "totalScore", "ibGrade"],
};

const EVIDENCE_FIRST_RULE = `For every criterion you must populate the fields in this order and mean it: cite the evidence
quotes FIRST, match them to named band-descriptor markers SECOND, and only then state the score as
the direct consequence of what you just cited. Never decide a score and backfill justification for
it. When genuinely on the fence between two bands and the evidence does not clearly settle it,
default to the LOWER one — real examiners grade harsher than this tool tends to.`;

function buildAudioGraderPrompt(studentName) {
  return `You are an IB Spanish Ab Initio examiner assessing a student's Individual Oral recording
(photo description + conversation). The student is ${studentName}.

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric()}
<<<END_FEEDBACK_MD>>>

You are listening to the ACTUAL AUDIO, not a transcript. Weigh what only the audio can tell you —
pronunciation, intonation, pacing, hesitation, false starts, and self-correction — alongside the
words themselves. feedback.md's criteria for these apply to what you HEAR, not just what was said.

${EVIDENCE_FIRST_RULE}

Write every field in English except verbatim Spanish quotes of the student's own words and Spanish
grammar terms. The transcript field stays in Spanish, as spoken.

Return only the structured scoring JSON — no student-facing prose write-up at this stage.`;
}

function buildTranscriptGraderPrompt(studentName, transcript) {
  return `You are an IB Spanish Ab Initio examiner assessing a student's Individual Oral. The student is
${studentName}.

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
grammatical accuracy, tense control, development of ideas, relevance, and interaction as visible in
the wording. Do NOT guess at pronunciation, intonation, or fluency — where a band descriptor turns
on something only audible, say so in bandMatch and score the rest of the criterion on the textual
evidence rather than inventing an impression of how it sounded.

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
        "A full, accurate, verbatim Spanish transcript of the student's spoken turns only — not " +
        "the examiner's questions unless needed for context. Preserve errors exactly as spoken " +
        "(do not silently correct the student's grammar). Mark unclear stretches [inaudible].",
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
    criterionB2: JUDGE_CRITERION_SCHEMA,
    criterionC: JUDGE_CRITERION_SCHEMA,
    totalScore: { type: SchemaType.NUMBER, description: "Sum of the four final sub-scores, out of 30." },
    ibGrade: {
      type: SchemaType.NUMBER,
      description: "IB grade 1–7, via feedback.md's Raw Score → IB Grade conversion table.",
    },
    feedback: {
      type: SchemaType.STRING,
      description:
        "The complete student-facing assessment in Markdown, following feedback.md's 'Required " +
        "output structure' section in order, using its exact disclaimer text verbatim, and " +
        "reporting the final reconciled scores above.",
    },
  },
  required: ["criterionA", "criterionB1", "criterionB2", "criterionC", "totalScore", "ibGrade", "feedback"],
};

function buildJudgePrompt(studentName, transcript, audioGrade, transcriptGrade) {
  return `You are the senior moderating examiner for an IB Spanish Ab Initio Individual Oral. The student
is ${studentName}.

Two independent examiners have already scored this same performance and you must reconcile them
into one final set of scores, then write the student-facing feedback.

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
- Where they differ, decide which evidence is actually load-bearing for that criterion. Criterion A
  (pronunciation/intonation) and Criterion C (interaction, hesitation, repair) genuinely depend on
  audible delivery, so Examiner 1's evidence should usually prevail there. Criterion B1 and B2
  (message content, development, relevance, cultural connection) turn on what was SAID, so a
  disagreement there more often means Examiner 1 was swayed by delivery — confident-sounding
  delivery must not inflate a thin message, and hesitant delivery must not deflate a substantive one.
- A wide gap (2+ points) is a signal that one examiner cited weak evidence. Go back to the quotes
  themselves and favour the examiner whose quotes actually demonstrate the band marker claimed.
- When the reconciled evidence leaves you genuinely on the fence, default to the LOWER score.
- Your final total must be the sum of your four reconciled sub-scores, converted to an IB grade
  using feedback.md's conversion table.

Then write the full student-facing feedback in Markdown, following feedback.md's 'Required output
structure' exactly and in order, reporting YOUR final reconciled scores (not either examiner's).
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

async function gradeFromAudio({ audioBuffer, mimeType, studentName }) {
  const result = await getModel(SCORES_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    { text: buildAudioGraderPrompt(studentName) },
  ]);
  return { grade: parseJson(result, "The audio grader"), usage: usageOf(result) };
}

async function transcribeAudio({ audioBuffer, mimeType }) {
  const result = await getModel(TRANSCRIPT_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    {
      text:
        "Transcribe this IB Spanish Ab Initio Individual Oral recording. Produce a faithful, " +
        "verbatim Spanish transcript of the student's spoken turns. Preserve the student's errors " +
        "exactly as spoken — do not correct grammar, agreement, or tense. Mark genuinely unclear " +
        "stretches [inaudible]. Do not assess or comment on the performance.",
    },
  ]);
  return { transcript: parseJson(result, "The transcriber").transcript, usage: usageOf(result) };
}

async function gradeFromTranscript({ transcript, studentName }) {
  const result = await getModel(SCORES_SCHEMA).generateContent(
    buildTranscriptGraderPrompt(studentName, transcript)
  );
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
    B2: grade.criterionB2.score,
    C: grade.criterionC.score,
    total: grade.totalScore,
  };
}

async function gradeRecording({ audioBuffer, mimeType, studentName }) {
  // The audio grader and the transcriber both need the audio, so they run concurrently; the
  // transcript grader then works from a source the audio grader never saw, which is what makes
  // the two verdicts an actual cross-check rather than the same call run twice.
  const [audio, transcription] = await Promise.all([
    gradeFromAudio({ audioBuffer, mimeType, studentName }),
    transcribeAudio({ audioBuffer, mimeType }),
  ]);

  const text = await gradeFromTranscript({
    transcript: transcription.transcript,
    studentName,
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
        B2: judged.verdict.criterionB2.score,
        C: judged.verdict.criterionC.score,
        total: judged.verdict.totalScore,
      },
    },
  };
}

module.exports = { gradeRecording };
