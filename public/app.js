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

const quizOverlay = document.getElementById("quiz-overlay");
const quizProgressText = document.getElementById("quiz-progress-text");
const quizQuestionEl = document.getElementById("quiz-question");
const quizOptionsEl = document.getElementById("quiz-options");
const quizFeedbackEl = document.getElementById("quiz-feedback");
const quizWaiting = document.getElementById("quiz-waiting");
const quizSkip = document.getElementById("quiz-skip");

let lastStudentName = "";

const PHOTO_PROGRESS_STEP = "Looking at your photo…";

const PROGRESS_STEPS = [
  "Uploading your recording…",
  "Listening to your pronunciation and delivery…",
  "Transcribing what you said…",
  "Checking your grammar and vocabulary…",
  "Cross-checking both assessments…",
  "Preparing your feedback…",
];

function cyclePlaceholderProgress(withPhoto) {
  const steps = withPhoto
    ? [PROGRESS_STEPS[0], PHOTO_PROGRESS_STEP, ...PROGRESS_STEPS.slice(1)]
    : PROGRESS_STEPS;
  let i = 0;
  progressText.textContent = steps[0];
  return setInterval(() => {
    i = (i + 1) % steps.length;
    progressText.textContent = steps[i];
  }, 6000);
}

// ---------- Photo upload (optional) ----------

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // keep in step with the server limit

const photoInput = document.getElementById("photo");
const photoDrop = document.getElementById("photo-drop");
const photoEmpty = document.getElementById("photo-empty");
const photoPreview = document.getElementById("photo-preview");
const photoThumb = document.getElementById("photo-thumb");
const photoName = document.getElementById("photo-name");
const photoError = document.getElementById("photo-error");
let photoObjectUrl = null;

function showPhotoError(message) {
  photoError.textContent = message;
  photoError.classList.toggle("hidden", !message);
}

function clearPhoto() {
  photoInput.value = "";
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = null;
  photoThumb.removeAttribute("src");
  photoThumb.classList.remove("hidden");
  photoPreview.classList.add("hidden");
  photoEmpty.classList.remove("hidden");
  showPhotoError("");
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
}

function showPhoto(file) {
  showPhotoError("");
  if (!isImageFile(file)) {
    clearPhoto();
    showPhotoError("That file is not an image. Please choose a JPG, PNG, WebP or HEIC photo.");
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    clearPhoto();
    showPhotoError("That photo is over 10MB. Please choose a smaller copy.");
    return;
  }
  if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = URL.createObjectURL(file);
  photoName.textContent = file.name;
  photoThumb.classList.remove("hidden");
  photoThumb.src = photoObjectUrl;
  photoEmpty.classList.add("hidden");
  photoPreview.classList.remove("hidden");
}

// Browsers other than Safari cannot draw a HEIC file; the upload still works, so just drop the
// thumbnail and keep the file name.
photoThumb.addEventListener("error", () => photoThumb.classList.add("hidden"));

document.getElementById("photo-btn").addEventListener("click", () => photoInput.click());
document.getElementById("photo-replace").addEventListener("click", () => photoInput.click());
document.getElementById("photo-remove").addEventListener("click", clearPhoto);

photoInput.addEventListener("change", () => {
  if (photoInput.files.length) showPhoto(photoInput.files[0]);
});

["dragenter", "dragover"].forEach((type) =>
  photoDrop.addEventListener(type, (e) => {
    e.preventDefault();
    photoDrop.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  photoDrop.addEventListener(type, (e) => {
    e.preventDefault();
    photoDrop.classList.remove("dragging");
  })
);
photoDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  // Assigning to input.files keeps FormData and the form's native validity in sync with the drop.
  const dt = new DataTransfer();
  dt.items.add(file);
  photoInput.files = dt.files;
  showPhoto(file);
});

// ---------- Verb-conjugation mini game (fills the grading wait time) ----------

const QUIZ_BANK = [
  { q: "🙋 Yo ___ (hablar) español.", options: ["hablo", "hablas", "habla", "hablan"], correct: 0 },
  { q: "🧍 Tú ___ (comer) mucha pizza.", options: ["come", "comes", "como", "comen"], correct: 1 },
  { q: "🌅 Todos los días, ella ___ (levantarse) a las siete.", options: ["levanta", "se levanta", "levanto", "levantas"], correct: 1 },
  { q: "🏫 Nosotros ___ (ir) a la escuela en autobús.", options: ["voy", "va", "vamos", "van"], correct: 2 },
  { q: "😴 Ellos ___ (dormir) ocho horas.", options: ["duermo", "duerme", "duermes", "duermen"], correct: 3 },
  { q: "🎬 Ahora mismo, yo ___ (ver) una película.", options: ["estoy viendo", "veo", "vi", "veré"], correct: 0 },
  { q: "☕ Mi madre ___ (tomar) café por la mañana.", options: ["tomo", "toma", "tomas", "toman"], correct: 1 },
  { q: "🎵 Vosotros ___ (escuchar) música todo el tiempo.", options: ["escucho", "escucha", "escucháis", "escuchan"], correct: 2 },
  { q: "🚿 Yo ___ (ducharse) antes de desayunar.", options: ["me ducho", "te duchas", "se ducha", "duchar"], correct: 0 },
  { q: "📖 Mis amigos ___ (leer) libros interesantes.", options: ["lee", "leo", "leen", "lees"], correct: 2 },
];

function pickQuizQuestions(n) {
  const pool = [...QUIZ_BANK];
  const picked = [];
  while (picked.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

const SPARK_COLORS = [
  "var(--m-strategic)",
  "var(--honey)",
  "var(--brand)",
  "var(--m-dialogic)",
  "var(--m-reflective)",
  "var(--m-design)",
];

function spawnSparks(btn) {
  for (let i = 0; i < 12; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const angle = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 30;
    const size = 5 + Math.random() * 5;
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    s.style.animationDelay = `${Math.random() * 0.08}s`;
    btn.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }
}

const CORRECT_MESSAGES = ["¡Correcto! 🎉", "¡Perfecto! ⭐", "¡Muy bien! 🙌", "¡Exacto! ✨", "¡Genial! 🔥"];
const INCORRECT_MESSAGES = ["¡Casi! 🙈", "¡Buen intento! 💪", "¡Sigue así! 🌈"];

function runQuiz(onFinished) {
  const questions = pickQuizQuestions(8);
  let index = 0;

  quizWaiting.classList.add("hidden");
  quizOptionsEl.classList.remove("hidden");
  quizQuestionEl.classList.remove("hidden");
  quizOverlay.classList.remove("hidden");

  function renderQuestion() {
    const q = questions[index];
    quizProgressText.textContent = `Question ${index + 1} of ${questions.length}`;
    quizQuestionEl.textContent = q.q;
    quizOptionsEl.innerHTML = "";
    quizFeedbackEl.textContent = "";
    quizFeedbackEl.className = "quiz-feedback";
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-option";
      btn.textContent = opt;
      btn.addEventListener("click", () => handleAnswer(i, btn));
      quizOptionsEl.appendChild(btn);
    });
  }

  function handleAnswer(i, btn) {
    const q = questions[index];
    const buttons = Array.from(quizOptionsEl.children);
    buttons.forEach((b) => (b.disabled = true));

    if (i === q.correct) {
      btn.classList.add("correct");
      spawnSparks(btn);
      quizFeedbackEl.textContent = CORRECT_MESSAGES[Math.floor(Math.random() * CORRECT_MESSAGES.length)];
      quizFeedbackEl.className = "quiz-feedback quiz-feedback-correct";
    } else {
      btn.classList.add("incorrect");
      buttons[q.correct].classList.add("correct");
      quizFeedbackEl.textContent = INCORRECT_MESSAGES[Math.floor(Math.random() * INCORRECT_MESSAGES.length)];
      quizFeedbackEl.className = "quiz-feedback quiz-feedback-incorrect";
    }

    setTimeout(() => {
      index++;
      if (index < questions.length) {
        renderQuestion();
      } else {
        onFinished(false);
      }
    }, 900);
  }

  quizSkip.onclick = () => {
    quizOverlay.classList.add("hidden");
    onFinished(true);
  };

  renderQuestion();
}

// ---------- Submission flow ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const name = document.getElementById("name").value.trim();
  const fileInput = document.getElementById("audio");

  if (!fileInput.files.length) return;

  lastStudentName = name;

  const fd = new FormData();
  fd.append("name", name);
  fd.append("audio", fileInput.files[0]);
  if (photoInput.files.length) fd.append("photo", photoInput.files[0]);

  submitBtn.disabled = true;

  let gradingSettled = false;
  let gradingData = null;
  let gradingError = null;

  const gradingPromise = fetch("/api/submit", { method: "POST", body: fd })
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      gradingData = data;
    })
    .catch((err) => {
      gradingError = err;
    })
    .finally(() => {
      gradingSettled = true;
    });

  function showResultOrError() {
    if (gradingError) {
      errorBox.textContent = gradingError.message;
      errorBox.classList.remove("hidden");
    } else if (gradingData) {
      resultEl.innerHTML = marked.parse(gradingData.feedback);
      formCard.classList.add("hidden");
      resultCard.classList.remove("hidden");
    }
    submitBtn.disabled = false;
  }

  runQuiz(async (skipped) => {
    if (skipped) {
      progress.classList.remove("hidden");
      const timer = cyclePlaceholderProgress(photoInput.files.length > 0);
      await gradingPromise;
      clearInterval(timer);
      progress.classList.add("hidden");
      showResultOrError();
      return;
    }

    if (!gradingSettled) {
      quizQuestionEl.classList.add("hidden");
      quizOptionsEl.classList.add("hidden");
      quizWaiting.classList.remove("hidden");
      await gradingPromise;
    }
    quizOverlay.classList.add("hidden");
    showResultOrError();
  });
});

downloadBtn.addEventListener("click", () => {
  const safeName = (lastStudentName || "student").replace(/[^a-z0-9]+/gi, "_");
  html2pdf()
    .set({
      margin: 12,
      filename: `SpeakBack_${safeName}.pdf`,
      // Ignore the page's scroll position: the button sits at the bottom of a long result, so the
      // window is always scrolled when it is clicked, and html2canvas paints blank pages if it is not told to
      // render from the top.
      html2canvas: { scale: 2, scrollX: 0, scrollY: 0 },
      // Move whole table rows, list items and headings to the next page instead of slicing through them.
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "li", "h2", "h3", "h4"] },
      jsPDF: { unit: "pt", format: "a4" },
    })
    .from(resultEl)
    .save();
});

againBtn.addEventListener("click", () => {
  form.reset();
  clearPhoto();
  resultCard.classList.add("hidden");
  formCard.classList.remove("hidden");
});

// ---------- Last-run usage popover ----------

const usageBtn = document.getElementById("usage-btn");
const usagePopover = document.getElementById("usage-popover");

function formatCost(usd) {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

async function toggleUsagePopover() {
  if (!usagePopover.classList.contains("hidden")) {
    usagePopover.classList.add("hidden");
    return;
  }

  usagePopover.innerHTML = `<div class="usage-title">Last run</div>Loading…`;
  usagePopover.classList.remove("hidden");

  try {
    const res = await fetch("/api/last-usage");
    const data = await res.json();
    if (!data.usage) {
      usagePopover.innerHTML = `<div class="usage-title">Last run</div>No runs yet.`;
      return;
    }
    const u = data.usage;
    const stages = (u.calls || [])
      .map(
        (c) =>
          `<div class="usage-row usage-stage"><span>${c.stage}</span><span>${c.totalTokens.toLocaleString()} · ${formatCost(c.estimatedCostUsd)}</span></div>`
      )
      .join("");
    usagePopover.innerHTML = `
      <div class="usage-title">Last run</div>
      <div class="usage-row"><span>Input tokens</span><span>${u.promptTokens.toLocaleString()}</span></div>
      <div class="usage-row"><span>Output tokens</span><span>${u.outputTokens.toLocaleString()}</span></div>
      <div class="usage-row"><span>Total tokens</span><span>${u.totalTokens.toLocaleString()}</span></div>
      <div class="usage-row usage-total"><span>Est. cost</span><span>${formatCost(u.estimatedCostUsd)}</span></div>
      ${stages}
    `;
  } catch (err) {
    usagePopover.innerHTML = `<div class="usage-title">Last run</div>Couldn't load usage.`;
  }
}

usageBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleUsagePopover();
});

document.addEventListener("click", (e) => {
  if (!usagePopover.classList.contains("hidden") && !usagePopover.contains(e.target) && e.target !== usageBtn) {
    usagePopover.classList.add("hidden");
  }
});
