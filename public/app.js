const form = document.getElementById("submit-form");
const submitBtn = document.getElementById("submit-btn");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progress-text");
const errorBox = document.getElementById("error-box");
const formCard = document.getElementById("form-card");
const resultCard = document.getElementById("result-card");
const resultEl = document.getElementById("result");
const downloadBtn = document.getElementById("download-btn");
const againBtn = document.getElementById("again-btn");

let lastStudentName = "";

const PROGRESS_STEPS = [
  "Uploading your recording…",
  "Listening and analyzing your Spanish…",
  "Preparing your feedback…",
];

function cyclePlaceholderProgress() {
  let i = 0;
  progressText.textContent = PROGRESS_STEPS[0];
  return setInterval(() => {
    i = (i + 1) % PROGRESS_STEPS.length;
    progressText.textContent = PROGRESS_STEPS[i];
  }, 6000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const name = document.getElementById("name").value.trim();
  const studentClass = document.getElementById("class").value.trim();
  const fileInput = document.getElementById("audio");

  if (!fileInput.files.length) return;

  lastStudentName = name;

  const fd = new FormData();
  fd.append("name", name);
  fd.append("class", studentClass);
  fd.append("audio", fileInput.files[0]);

  submitBtn.disabled = true;
  progress.classList.remove("hidden");
  const timer = cyclePlaceholderProgress();

  try {
    const res = await fetch("/api/submit", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Something went wrong. Please try again.");
    }

    resultEl.innerHTML = marked.parse(data.feedback);
    formCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
  } finally {
    clearInterval(timer);
    progress.classList.add("hidden");
    submitBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  const safeName = (lastStudentName || "student").replace(/[^a-z0-9]+/gi, "_");
  html2pdf()
    .set({
      margin: 12,
      filename: `SpeakBack_${safeName}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: "pt", format: "a4" },
    })
    .from(resultEl)
    .save();
});

againBtn.addEventListener("click", () => {
  form.reset();
  resultCard.classList.add("hidden");
  formCard.classList.remove("hidden");
});
