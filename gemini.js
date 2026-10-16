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

// Each class has its own teacher-calibrated rubric file and exam label. Spanish Ab Initio's path
// stays overridable via FEEDBACK_MD_PATH for backward compatibility with existing .env setups.
const CLASS_CONFIG = {
  "Spanish Ab Initio": {
    label: "IB Spanish Ab Initio",
    rubricPath: process.env.FEEDBACK_MD_PATH || "./feedback.md",
    pairRubricPath: process.env.FEEDBACK_MD_PATH_PAIR || "./feedback-pair.md",
  },
  "Spanish B": {
    label: "IB Spanish B",
    rubricPath: process.env.FEEDBACK_MD_PATH_SPANISH_B || "./feedback-spanish-b.md",
    pairRubricPath: process.env.FEEDBACK_MD_PATH_PAIR_SPANISH_B || "./feedback-pair-spanish-b.md",
  },
};

// "solo": one speaker describes the photo (Criterion A + B1, /18).
// "pair": a speaker plus a peer acting as examiner, so a conversation follows (A + B1 + B2 + C, /30).
const FORMATS = ["solo", "pair"];

function classConfigFor(studentClass) {
  const config = CLASS_CONFIG[studentClass];
  if (!config) {
    throw new Error(`Unknown class "${studentClass}". Expected one of: ${Object.keys(CLASS_CONFIG).join(", ")}`);
  }
  return config;
}

function readFeedbackRubric(studentClass, format) {
  const config = classConfigFor(studentClass);
  const rubricPath = path.resolve(__dirname, format === "pair" ? config.pairRubricPath : config.rubricPath);
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
resource — it contains the required output structure, the assessment criteria with band
descriptors, the reference material and phrase banks, and real examiner-derived band
differentiators. Follow it exactly and in full — do not substitute your own generic IB rubric
knowledge or output format.`;

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

// Solo mode scores only A and B1: an unaccompanied monologue has no material for Criterion B2
// (conversation) or Criterion C (interaction) — see SOLO_FORMAT. Pair mode adds B2 and C.
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

const PAIR_SCORES_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description:
        "The full Spanish transcript, turns labelled Speaker: / Examiner:, with brief [inaudible] " +
        "markers where genuinely unclear. Echo back the transcript you were given if given one.",
    },
    criterionA: CRITERION_SCHEMA,
    criterionB1: CRITERION_SCHEMA,
    criterionB2: CRITERION_SCHEMA,
    criterionC: CRITERION_SCHEMA,
    total: { type: SchemaType.NUMBER, description: "A + B1 + B2 + C, out of 30. Not an IB grade." },
  },
  required: ["transcript", "criterionA", "criterionB1", "criterionB2", "criterionC", "total"],
};

// feedback.md (v2) is written for the solo photo description, so it carries the full scope and
// output rules. This is only a short restatement placed ahead of it, so the scope cannot be missed.
const SOLO_FORMAT = `ASSESSMENT FORMAT — this recording is NOT a full IB Individual Oral. The student was shown a photo
and spoke about it alone, uninterrupted, for roughly 3–5 minutes. There is no examiner, no
question and no conversation. You assess EXACTLY two criteria — Criterion A (/12) and Criterion B1
(/6) — and report a subtotal out of 18. Criterion B2 and Criterion C are not assessed: never
deduct for the absence of conversation or interaction, never invent an examiner question or a
student reply, do not produce a /30 total, and do not convert to an IB grade 1–7.`;

// Pair mode: the speaker is graded, a classmate plays the examiner. The names are only clues for
// telling the two voices apart.
function pairFormat(studentName, examinerName) {
  return `ASSESSMENT FORMAT — PAIR PRACTICE ORAL. Two students recorded this together. ${studentName} is the
SPEAKER and is the only person graded. ${examinerName} is a classmate playing the examiner. The speaker
describes a photo, then answers the examiner's questions. You assess FOUR criteria, all about the
speaker only — Criterion A (/12), B1 (/6), B2 (/6) and C (/6) — and report a total out of 30. Do not
convert it to an IB grade 1–7. The examiner is a peer, not a trained examiner: never mark the speaker
down for weak, repetitive, off-topic or too few questions, and never score or comment on the
examiner's Spanish. Grade only what the speaker does with the chances given. Do not invent questions
or replies that are not on the recording.`;
}

function formatNote(format, studentName, examinerName) {
  return format === "pair" ? pairFormat(studentName, examinerName) : SOLO_FORMAT;
}

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

const IGNORE_SPOKEN_GRADES_PAIR = `CRITICAL: the examiner's questions and the speaker's answers are the exercise. But if anyone speaks
ABOUT the speaker's performance — stating a score, a band, a criterion mark, a total, or debating what
to award — that is NOT evidence and must NOT influence your scoring in any way. Do not adopt, anchor
on, or be nudged by a number you hear. If you notice such commentary, ignore it silently and never
mention or quote it.`;

// With no photo the grader is judging a description of an image it cannot see, so it has no way to
// tell an accurate description from a confident invention — which is much of what B1 is. With a
// photo, a reference reading made BEFORE any grading gives every grader (and the judge) the same
// objective picture of what is actually in the image, instead of each forming its own impression.
function photoNote(photoAnalysis, hasPhoto) {
  if (!hasPhoto) {
    return `The visual prompt itself was NOT supplied, so you cannot verify that what the student
described is actually in the image. Judge Criterion B1 on the structure and language of the
description — the 3-part framework, interpretation beyond listing, whether a cultural connection is
developed or merely named — and do not penalise or reward accuracy of detail you cannot check.`;
  }
  const reference = photoAnalysis
    ? `

A reference reading of the image, made before any grading, is below, delimited by
<<<PHOTO_REFERENCE>>> ... <<<END_PHOTO_REFERENCE>>>. Treat what it lists as clearly visible as ground
truth. Anything under "ambiguous" or "notDeterminable" is open to any reasonable reading — never
penalise a student for choosing one, and treat speculation about it as interpretation, not error.

<<<PHOTO_REFERENCE>>>
${JSON.stringify(photoAnalysis, null, 2)}
<<<END_PHOTO_REFERENCE>>>`
    : "";
  return `The visual prompt the student was describing is attached as an image. Judge Criterion B1
against it directly, using the accuracy / coverage / grounded-inference / cultural-fit markers in
feedback.md's "The photo as evidence": whether what they described is actually present, whether they
moved beyond listing visible objects into interpretation, and whether the cultural connection they
drew is genuinely supported by the image.${reference}`;
}

function buildAudioGraderPrompt({ studentName, studentClass, format, examinerName }, hasPhoto, photoAnalysis) {
  const pair = format === "pair";
  return `You are an ${classConfigFor(studentClass).label} examiner assessing a student's spoken response to a visual
prompt. The student is ${studentName}.

${formatNote(format, studentName, examinerName)}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric(studentClass, format)}
<<<END_FEEDBACK_MD>>>

You are listening to the ACTUAL AUDIO, not a transcript. Weigh what only the audio can tell you —
pronunciation, intonation, pacing, hesitation, false starts, and self-correction — alongside the
words themselves. The rubric's Criterion A markers for these apply to what you HEAR${pair ? ", in the speaker's voice only" : ""}.

${photoNote(photoAnalysis, hasPhoto)}

${pair ? IGNORE_SPOKEN_GRADES_PAIR : IGNORE_SPOKEN_GRADES}

${EVIDENCE_FIRST_RULE}

Write every field in English except verbatim Spanish quotes of the student's own words and Spanish
grammar terms. The transcript field stays in Spanish, as spoken.

Return only the structured scoring JSON — no student-facing prose write-up at this stage.`;
}

function buildTranscriptGraderPrompt({ studentName, studentClass, format, examinerName }, transcript, hasPhoto, photoAnalysis) {
  return `You are an ${classConfigFor(studentClass).label} examiner assessing a student's spoken response to a visual
prompt. The student is ${studentName}.

${formatNote(format, studentName, examinerName)}

${photoNote(photoAnalysis, hasPhoto)}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric(studentClass, format)}
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
    hasStudentSpeech: {
      type: SchemaType.BOOLEAN,
      description:
        "True only if a student is actually speaking Spanish as an attempt to describe a visual " +
        "prompt. False if the recording is silence, noise, only a teacher or someone else setting " +
        "up or talking about the recording, or only a few stray words.",
    },
    voiceCount: {
      type: SchemaType.INTEGER,
      description:
        "How many different people take part in the Spanish exercise itself (1 if one person " +
        "describes the photo alone, 2 if a second person asks questions or converses). Do not " +
        "count someone who only introduces the recording or comments on the performance.",
    },
  },
  required: ["transcript", "hasStudentSpeech", "voiceCount"],
};

// A real 3–5 minute description runs to hundreds of words. Anything under this is not something
// that can be graded, so it is cheaper and kinder to ask for a re-recording than to run four calls
// and hand back a 0/18.
const MIN_STUDENT_WORDS = 30;

class NoStudentSpeechError extends Error {
  constructor(usage) {
    super("No student speech was found in the recording.");
    this.code = "NO_STUDENT_SPEECH";
    this.usage = usage; // the transcription still cost something, so the server can record it
  }
}

function studentWordCount(transcript) {
  return transcript
    .replace(/\[[^\]]*\]/g, " ") // [inaudible] and similar markers are not words
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Pair transcripts are labelled turn by turn; only the speaker's own turns count toward the minimum.
function speakerWordCount(labelled) {
  const spoken = labelled
    .split("\n")
    .filter((line) => !/^\s*\**\s*examiner\s*\**\s*:/i.test(line))
    .map((line) => line.replace(/^\s*\**\s*speaker\s*\**\s*:/i, ""))
    .join(" ");
  return studentWordCount(spoken);
}

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
        "the final reconciled marks above, with no band numbers or band labels anywhere and no " +
        "mention of Conversation, Interaction or the full exam.",
    },
  },
  required: ["criterionA", "criterionB1", "subtotal", "feedback"],
};

const PAIR_JUDGE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    criterionA: JUDGE_CRITERION_SCHEMA,
    criterionB1: JUDGE_CRITERION_SCHEMA,
    criterionB2: JUDGE_CRITERION_SCHEMA,
    criterionC: JUDGE_CRITERION_SCHEMA,
    total: { type: SchemaType.NUMBER, description: "A + B1 + B2 + C, out of 30. Not an IB grade." },
    feedback: {
      type: SchemaType.STRING,
      description:
        "The complete student-facing assessment in Markdown, following the rubric's 'Required output " +
        "structure' section in order, using its exact disclaimer text verbatim, reporting the final " +
        "reconciled marks above (A /12, B1, B2, C /6 each, total /30), with no band numbers or band " +
        "labels anywhere, no IB grade, and no comment on the examiner.",
    },
  },
  required: ["criterionA", "criterionB1", "criterionB2", "criterionC", "total", "feedback"],
};

function buildJudgePrompt({ studentName, studentClass, format, examinerName }, transcript, audioGrade, transcriptGrade, hasPhoto, photoAnalysis) {
  const pair = format === "pair";
  return `You are the senior moderating examiner for an ${classConfigFor(studentClass).label} oral practice task. The student
is ${studentName}.

Two independent examiners have already scored this same performance and you must reconcile them
into one final set of scores, then write the student-facing feedback.

${formatNote(format, studentName, examinerName)}

${RUBRIC_PREAMBLE}

<<<FEEDBACK_MD>>>
${readFeedbackRubric(studentClass, format)}
<<<END_FEEDBACK_MD>>>

${photoNote(photoAnalysis, hasPhoto)}

The transcript of what ${pair ? "was said (turns labelled Speaker and Examiner; only the Speaker is graded)" : "the student actually said"}:

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
- **Criterion A: take Examiner 1's score.** It turns on things only the audio carries —
  pronunciation, intonation, hesitation, repair — and Examiner 2 could not hear any of it, so a lower
  mark from Examiner 2 here reflects deafness to the evidence, not a stricter reading of it. Depart
  from Examiner 1's score on A ONLY when Examiner 1's own cited quotes contradict the score it
  assigned (for example, quotes showing repeated breakdown paired with a high band). Examiner 2
  being lower is not by itself a reason.
- **Criterion B1: weigh the quotes, and lean on Examiner 2 where they conflict.** It turns on what
  was actually SAID — message content, development, relevance, cultural connection — which is fully
  visible in the transcript. A disagreement here usually means Examiner 1 was swayed by delivery:
  confident-sounding delivery must not inflate a thin message, and hesitant delivery must not deflate
  a substantive one. Where the photo is supplied, check each disputed claim against the image and the
  reference reading — whether a described detail is really there settles it.
- A wide gap (2+ points) means one examiner cited weak evidence. Go back to the quotes themselves
  and favour the examiner whose quotes actually demonstrate the band marker claimed.
- Only when the reconciled evidence leaves you genuinely on the fence between two adjacent scores,
  and the quotes truly do not settle it, take the LOWER of the two. This is a last-resort tiebreak
  for a real coin-flip, not a general instruction to grade conservatively — do not apply it to a
  call the evidence does settle, and do not stack it on top of a score you already reasoned down.
${
  pair
    ? `- **Criterion B2: lean on Examiner 2.** It turns on what the speaker said in answer to the questions —
  development, unprompted elaboration, personal interpretation — all visible in the transcript. Do not
  lower it because the peer examiner's questions were thin; score what the speaker did with them.
- **Criterion C: weigh both.** Comprehension and sustained participation show in the words, but
  hesitation, needing questions repeated and how naturally the exchange flows are audible. Where they
  differ, favour the examiner whose quotes show it. Never lower it because the examiner was weak.
- Your total is Criterion A + B1 + B2 + C, out of 30. Do not convert it to an IB grade 1–7.`
    : `- Your subtotal is Criterion A + Criterion B1, out of 18. Do not produce a /30 total and do not
  convert to an IB grade 1–7.`
}

Then write the full student-facing feedback in Markdown, following the rubric's 'Required output
structure' in order. Report YOUR final reconciled scores (not either examiner's). Do not add a
standalone section describing what the photo contains — accuracy against the image appears only
where it bears on the Photo Description Breakdown and the B1 scoring.

STUDENT-FACING MARKS ONLY. The student must never see a band: no band number, no band range, no
"Band 5", "Level 6" or "the higher band" anywhere in the feedback — not in the score table, the
scoring section, the targets or the recommendations. Use the bands privately to decide each mark,
then show only the marks ${
  pair
    ? "(A X/12; B1, B2 and C X/6 each; total X/30)"
    : "(X/12, X/6, subtotal X/18)"
} and the reasons, expressing every target as marks ("B1 3/6 → 5/6"). ${
  pair
    ? "Do not show an IB grade 1–7 and do not comment on the examiner or on their questions."
    : "Do not mention Criterion B2, Criterion C, the other 12 marks, or the full exam."
}

Ground every claim in a quoted moment, drawing on the evidence both examiners cited. Never mention
the two examiners, the reconciliation process, or that multiple passes happened — to the student
this is simply their assessment.

Write the feedback directly to the ${pair ? "speaker" : "student"}, who is reading their own feedback: use "you" and "your"
throughout, and never "the student", "the candidate", "he", "she" or "they" for them.

Write the feedback in English throughout. The only Spanish allowed is verbatim quotes of the
student's own words and Spanish grammar terms.

The feedback field must be valid Markdown with real newline characters separating every block
element — a blank line before and after each heading, each table, and each list, and each table row
on its own line. Do not run headings, tables, or list items together on a single line.`;
}

// ---------- Pipeline stages ----------

// ---------- Photo analysis (runs first, from the image alone) ----------

const PHOTO_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    scene: {
      type: SchemaType.STRING,
      description:
        "An objective 2–4 sentence description of what is visibly in the image: setting, people " +
        "(how many, what they are doing, clothing), objects, and how it is composed.",
    },
    keyElements: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "The 6–12 most salient visible elements a strong description would be expected to cover, " +
        "most prominent first.",
    },
    visibleText: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "Any legible text, signs or logos, exactly as written, each followed by its language. " +
        "Empty array if there is none.",
    },
    culturalIndicators: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          cue: { type: SchemaType.STRING, description: "What is visible." },
          suggests: { type: SchemaType.STRING, description: "What it points to (a country, region or custom)." },
          confidence: { type: SchemaType.STRING, description: "high, medium or low." },
        },
        required: ["cue", "suggests", "confidence"],
      },
      description:
        "Visible cues that point to a Spanish-speaking country, region or custom. Empty array if " +
        "nothing visible does — do not assume the setting is Spanish-speaking.",
    },
    ambiguous: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description:
        "Details that are unclear, partly hidden, or open to more than one reasonable reading.",
    },
    notDeterminable: {
      type: SchemaType.STRING,
      description:
        "What cannot be known from the image alone (names, exact place, time, relationships, " +
        "intentions) and so can only be speculated about.",
    },
  },
  required: ["scene", "keyElements", "visibleText", "culturalIndicators", "ambiguous", "notDeterminable"],
};

async function analyzePhoto({ photo }) {
  const result = await getModel(PHOTO_SCHEMA).generateContent([
    ...photoPart(photo),
    {
      text:
        "This image is the visual prompt an IB Spanish student was given to describe aloud. " +
        "Produce an objective reference reading of it that examiners will later use to check the " +
        "student's description against what is actually there.\n\n" +
        "Report only what is visible. Do not interpret beyond the evidence, and do not assume the " +
        "scene is in a Spanish-speaking country because the task is a Spanish one — list cultural " +
        "indicators only if something visible supports them. Be explicit about what is ambiguous " +
        "and what cannot be known. Write in English, quoting any visible text in its original language.",
    },
  ]);
  return { analysis: parseJson(result, "The photo analyzer"), usage: usageOf(result) };
}

function photoPart(photo) {
  return photo ? [{ inlineData: { mimeType: photo.mimeType, data: photo.buffer.toString("base64") } }] : [];
}

async function gradeFromAudio({ audioBuffer, mimeType, who, photo, photoAnalysis }) {
  const result = await getModel(who.format === "pair" ? PAIR_SCORES_SCHEMA : SCORES_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    ...photoPart(photo),
    { text: buildAudioGraderPrompt(who, !!photo, photoAnalysis) },
  ]);
  return { grade: parseJson(result, "The audio grader"), usage: usageOf(result) };
}

async function transcribeAudio({ audioBuffer, mimeType, who }) {
  const pair = who.format === "pair";
  const pairText =
    `Transcribe this recording of two students practising a Spanish oral. ${who.studentName} is the ` +
    `SPEAKER, who describes a visual prompt and then answers questions. ${who.examinerName} is a ` +
    "classmate playing the examiner and asking the questions. Use the two names only as clues for " +
    "telling the voices apart. Produce a faithful, verbatim transcript of the whole recording, one " +
    "turn per line, each line starting with 'Speaker:' or 'Examiner:'. Preserve the speaker's errors " +
    "exactly as spoken — do not correct grammar, agreement, or tense. Mark genuinely unclear " +
    "stretches [inaudible]. Do not assess or comment on the performance. If anyone speaks ABOUT the " +
    "performance — a score, a band or a mark — leave it out. Set hasStudentSpeech to true only if " +
    "the speaker really speaks Spanish about the visual prompt.";
  const result = await getModel(TRANSCRIPT_SCHEMA).generateContent([
    { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
    {
      text: pair
        ? pairText
        : "Transcribe this recording of a student speaking Spanish about a visual prompt. Produce a " +
        "faithful, verbatim Spanish transcript of everything the student says, start to finish. " +
        "Preserve the student's errors exactly as spoken — do not correct grammar, agreement, or " +
        "tense. Mark genuinely unclear stretches [inaudible]. Do not assess or comment on the " +
        "performance.\n\n" +
        "If a teacher or examiner speaks at any point — asking a question, or discussing the " +
        "student's performance, a score, a band or a mark — exclude all of it and transcribe only " +
        "the student's own speech. Never carry a spoken score or band into the transcript.",
    },
  ]);
  const parsed = parseJson(result, "The transcriber");
  return {
    transcript: parsed.transcript,
    hasStudentSpeech: parsed.hasStudentSpeech,
    voiceCount: parsed.voiceCount,
    usage: usageOf(result),
  };
}

async function gradeFromTranscript({ transcript, who, photo, photoAnalysis }) {
  const result = await getModel(who.format === "pair" ? PAIR_SCORES_SCHEMA : SCORES_SCHEMA).generateContent([
    ...photoPart(photo),
    { text: buildTranscriptGraderPrompt(who, transcript, !!photo, photoAnalysis) },
  ]);
  return { grade: parseJson(result, "The transcript grader"), usage: usageOf(result) };
}

async function judgeGrades({ who, transcript, audioGrade, transcriptGrade, photo, photoAnalysis }) {
  const result = await getModel(who.format === "pair" ? PAIR_JUDGE_SCHEMA : JUDGE_SCHEMA).generateContent([
    ...photoPart(photo),
    { text: buildJudgePrompt(who, transcript, audioGrade, transcriptGrade, !!photo, photoAnalysis) },
  ]);
  return { verdict: parseJson(result, "The judge"), usage: usageOf(result) };
}

// ---------- Orchestration ----------

function formatFlagFor(format, voiceCount) {
  if (format === "solo" && voiceCount >= 2) return "Marked Individual, but two voices were heard. Check the format.";
  if (format === "pair" && voiceCount === 1) return "Marked Pair, but only one voice was heard. Check the format.";
  return null;
}

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

function scoresOf(grade, format) {
  if (format === "pair") {
    return {
      A: grade.criterionA.score,
      B1: grade.criterionB1.score,
      B2: grade.criterionB2.score,
      C: grade.criterionC.score,
      total: grade.total,
    };
  }
  return {
    A: grade.criterionA.score,
    B1: grade.criterionB1.score,
    total: grade.subtotal,
  };
}

async function gradeRecording({ audioBuffer, mimeType, studentName, studentClass, format = "solo", examinerName = "", photo }) {
  classConfigFor(studentClass); // throws early if the class is unrecognized
  if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}".`);
  const who = { studentName, studentClass, format, examinerName };
  const pair = format === "pair";
  // The photo is read first, from the image alone, so every grader and the judge share one objective
  // account of what is actually in it. It is independent of the audio, so it runs concurrently with
  // transcription. A failed or blocked analysis must not lose the submission: the graders still get
  // the image itself and simply grade without the reference reading.
  const photoStage = photo
    ? analyzePhoto({ photo }).catch((err) => {
        console.error("Photo analysis failed — grading without a reference reading:", err.message);
        return null;
      })
    : Promise.resolve(null);

  const [photoRead, transcription] = await Promise.all([photoStage, transcribeAudio({ audioBuffer, mimeType, who })]);
  const photoAnalysis = photoRead ? photoRead.analysis : null;

  // Stop here if there is nothing to grade: no further calls, and the caller does not save it.
  const words = pair ? speakerWordCount(transcription.transcript) : studentWordCount(transcription.transcript);
  if (!transcription.hasStudentSpeech || words < MIN_STUDENT_WORDS) {
    throw new NoStudentSpeechError(
      sumUsage([
        ...(photoRead ? [{ stage: "photo-analysis", usage: photoRead.usage }] : []),
        { stage: "transcriber", usage: transcription.usage },
      ])
    );
  }

  // The audio grader needs the photo reading, so it runs after it; the transcript grader then works
  // from a source the audio grader never saw, which is what makes the two verdicts an actual
  // cross-check rather than the same call run twice. Both only need the photo reading and the
  // transcript, so they run together.
  const [audio, text] = await Promise.all([
    gradeFromAudio({ audioBuffer, mimeType, who, photo, photoAnalysis }),
    gradeFromTranscript({ transcript: transcription.transcript, who, photo, photoAnalysis }),
  ]);

  const judged = await judgeGrades({
    who,
    transcript: transcription.transcript,
    audioGrade: audio.grade,
    transcriptGrade: text.grade,
    photo,
    photoAnalysis,
  });

  const usage = sumUsage([
    ...(photoRead ? [{ stage: "photo-analysis", usage: photoRead.usage }] : []),
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
      audio: scoresOf(audio.grade, format),
      transcript: scoresOf(text.grade, format),
      final: scoresOf(judged.verdict, format),
    },
    // The dropdown on the form decides how a recording is graded. The transcriber only double-checks
    // how many people it heard; a mismatch is flagged for the teacher in /admin, never acted on.
    formatFlag: formatFlagFor(format, transcription.voiceCount),
  };
}

module.exports = { gradeRecording, NoStudentSpeechError, studentWordCount, FORMATS };
