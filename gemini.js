const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    transcript: {
      type: SchemaType.STRING,
      description:
        "A full, accurate Spanish transcript of the student's spoken turns only — not the " +
        "examiner's questions unless needed for context. Include brief [inaudible] markers where " +
        "genuinely unclear.",
    },
    feedback: {
      type: SchemaType.STRING,
      description:
        "The complete assessment, following feedback.md's 'Required output structure' section in " +
        "order, using its exact disclaimer text verbatim as instructed, written in Markdown.",
    },
  },
  required: ["transcript", "feedback"],
};

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

function buildPrompt(studentName) {
  const rubric = readFeedbackRubric();
  return `You are an IB Spanish Ab Initio examiner assessing a student's Individual Oral recording
(photo description + conversation). The student is ${studentName}.

The text below, delimited by <<<FEEDBACK_MD>>> ... <<<END_FEEDBACK_MD>>>, is your complete grading
resource — it contains the required output structure, all four assessment criteria with band
descriptors, the raw-score-to-IB-grade conversion table, the taught "Describir la Foto" 3-part
framework and phrase banks, the grammar-trigger cheat sheet, and real examiner-derived band
differentiators grounded in previously graded student transcripts. Follow it exactly and in full —
do not substitute your own generic IB rubric knowledge or output format.

<<<FEEDBACK_MD>>>
${rubric}
<<<END_FEEDBACK_MD>>>

You are listening to the actual audio, not a transcript, so use that to additionally judge
pronunciation, intonation, pacing, hesitation, and self-correction — feedback.md's criteria for
these should be read as applying to what you hear, not just what was said.

Write the feedback assessment in English throughout — every heading, explanation, and comment.
The only Spanish allowed is when directly quoting the student's actual words (e.g. in the
Targeted Corrections table and as evidence in the Rubric-Based Scoring section) or naming a
Spanish grammar term (e.g. "pretérito indefinido") — feedback.md's own Spanish column headers and
teacher-tone examples describe style/content, not the language to write in. The transcript field
should remain in Spanish, as spoken.

The feedback field must be valid Markdown with real newline characters separating every block
element — a blank line before and after each heading, each table, and each list, and each table
row on its own line. Do not run headings, tables, or list items together on a single line.

Return the transcript and the feedback assessment as the two fields of the JSON response.`;
}

async function gradeRecording({ audioBuffer, mimeType, studentName }) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  const prompt = buildPrompt(studentName);

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: audioBuffer.toString("base64"),
      },
    },
    { text: prompt },
  ]);

  const rawText = result.response.text();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error("Gemini returned a response that could not be parsed as JSON: " + err.message);
  }

  if (typeof parsed.transcript !== "string" || typeof parsed.feedback !== "string") {
    throw new Error("Gemini's JSON response is missing the expected transcript/feedback fields.");
  }

  const usage = result.response.usageMetadata || {};

  return {
    transcript: parsed.transcript.trim(),
    feedback: normalizeMarkdown(parsed.feedback.trim()),
    usage: {
      promptTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    },
  };
}

module.exports = { gradeRecording };
