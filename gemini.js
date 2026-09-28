const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const TRANSCRIPT_MARKER = "===TRANSCRIPT===";
const FEEDBACK_MARKER = "===FEEDBACK===";

function readFeedbackRubric() {
  const rubricPath = path.resolve(__dirname, process.env.FEEDBACK_MD_PATH || "../feedback.md");
  return fs.readFileSync(rubricPath, "utf8");
}

function buildPrompt(studentName, studentClass) {
  const rubric = readFeedbackRubric();
  return `You are an IB Spanish Ab Initio examiner assessing a student's Individual Oral recording
(photo description + conversation). The student is ${studentName}, class ${studentClass}.

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

Respond in EXACTLY this format, with these two literal marker lines and nothing before the first
marker:

${TRANSCRIPT_MARKER}
(A full, accurate Spanish transcript of the student's spoken turns only — not the examiner's
questions unless needed for context. Include brief [inaudible] markers where genuinely unclear.)

${FEEDBACK_MARKER}
(The complete assessment, following feedback.md's "Required output structure" section in order,
using its exact disclaimer text verbatim as instructed, written in Markdown.)`;
}

function splitResponse(rawText) {
  const transcriptIndex = rawText.indexOf(TRANSCRIPT_MARKER);
  const feedbackIndex = rawText.indexOf(FEEDBACK_MARKER);

  if (transcriptIndex === -1 || feedbackIndex === -1) {
    return { transcript: "", feedback: rawText.trim() };
  }

  const transcript = rawText
    .slice(transcriptIndex + TRANSCRIPT_MARKER.length, feedbackIndex)
    .trim();
  const feedback = rawText.slice(feedbackIndex + FEEDBACK_MARKER.length).trim();

  return { transcript, feedback };
}

async function gradeRecording({ audioBuffer, mimeType, studentName, studentClass }) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.0-flash" });

  const prompt = buildPrompt(studentName, studentClass);

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
  return splitResponse(rawText);
}

module.exports = { gradeRecording };
