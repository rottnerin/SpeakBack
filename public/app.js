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
const gameScoreEl = document.getElementById("game-score");
const gameStrikesEl = document.getElementById("game-strikes");
const gameStageWrap = document.getElementById("game-stage-wrap");
const gameStage = document.getElementById("game-stage");
const gameFloorEl = document.getElementById("game-floor");
const gameMuteBtn = document.getElementById("game-mute");
const gameTargetEl = document.getElementById("game-target");
const gameFeedbackEl = document.getElementById("game-feedback");
const gameOverEl = document.getElementById("game-over");
const gameFinalScoreEl = document.getElementById("game-final-score");
const gameAgainBtn = document.getElementById("game-again");
const gameStatusEl = document.getElementById("game-status");
const gameReadyBtn = document.getElementById("game-ready");
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

// ---------- Vocabulary pop game (fills the grading wait time) ----------

// Photo-description vocabulary: [Spanish, English].
const GAME_WORDS = [
  ["la playa", "the beach"], ["el mar", "the sea"], ["la montaña", "the mountain"],
  ["el edificio", "the building"], ["la calle", "the street"], ["la ciudad", "the city"],
  ["el parque", "the park"], ["el árbol", "the tree"], ["la ventana", "the window"],
  ["la puerta", "the door"], ["el coche", "the car"], ["la bicicleta", "the bicycle"],
  ["el mercado", "the market"], ["la plaza", "the square"], ["la iglesia", "the church"],
  ["el puente", "the bridge"], ["la familia", "the family"], ["los amigos", "the friends"],
  ["el niño", "the boy"], ["la niña", "the girl"], ["el sombrero", "the hat"],
  ["las gafas", "the glasses"], ["la mochila", "the backpack"], ["el abrigo", "the coat"],
  ["la comida", "the food"], ["el pescado", "the fish"], ["la fiesta", "the party"],
  ["la bandera", "the flag"], ["el cielo", "the sky"], ["las nubes", "the clouds"],
  ["la lluvia", "the rain"], ["el río", "the river"], ["el perro", "the dog"],
  ["el gato", "the cat"], ["la mesa", "the table"], ["el libro", "the book"],
];

const GAME_LANES = 4;
const GAME_ROUNDS = 6;

const BALLOON_COLORS = [
  { light: "#ff9a9e", main: "#e5484d", dark: "#a82025" },
  { light: "#ffbe73", main: "#ed7004", dark: "#b04f00" },
  { light: "#ffd75e", main: "#d99a00", dark: "#8f6200" },
  { light: "#9be6bf", main: "#3ba985", dark: "#1f7a5c" },
  { light: "#8fc0ee", main: "#2977bc", dark: "#004b98" },
  { light: "#cdb0f5", main: "#8a5cd6", dark: "#5a3399" },
  { light: "#ffbfd8", main: "#e8629b", dark: "#a8316a" },
];

const popSound = new Audio("assets/sounds/balloon_pop.mp3");
popSound.preload = "auto";
let soundOn = true;
try {
  soundOn = localStorage.getItem("sbSound") !== "off";
} catch (e) {}

function playPop() {
  if (!soundOn) return;
  const a = popSound.cloneNode();
  a.volume = 0.5;
  a.play().catch(() => {});
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rubber shards, a shockwave ring and a short label at the point a balloon bursts.
function burst(x, y, color, label) {
  playPop();
  const ring = document.createElement("span");
  ring.className = "pop-ring";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  gameStage.appendChild(ring);
  setTimeout(() => ring.remove(), 450);

  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.className = "shard";
    const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 34 + Math.random() * 46;
    const size = 7 + Math.random() * 8;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.background = i % 3 === 0 ? color.light : i % 3 === 1 ? color.main : color.dark;
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist + 18}px`);
    s.style.setProperty("--rot", `${Math.round(Math.random() * 540 - 270)}deg`);
    gameStage.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }

  if (label) {
    const t = document.createElement("span");
    t.className = "pop-text";
    t.textContent = label;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
    gameStage.appendChild(t);
    setTimeout(() => t.remove(), 800);
  }
}

// Returns { notifyReady }. onFinished(skipped) fires when the student skips or opens their feedback.
function runGame(onFinished) {
  let score = 0;
  let round = 0;
  let target = null;
  let lastSpanish = null;
  let balloons = [];
  let roundActive = false;
  let over = false;
  let finished = false;
  let rafId = 0;
  let lastTs = 0;
  const timers = new Set();

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  function finish(skipped) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    timers.forEach(clearTimeout);
    timers.clear();
    quizOverlay.classList.add("hidden");
    onFinished(skipped);
  }

  function renderStats(bump) {
    gameScoreEl.textContent = String(score);
    if (bump) {
      gameScoreEl.classList.remove("bump");
      void gameScoreEl.offsetWidth;
      gameScoreEl.classList.add("bump");
    }
    gameStrikesEl.textContent = `${round}/${GAME_ROUNDS}`;
  }

  function clearBalloons() {
    balloons.forEach((b) => b.el.remove());
    balloons = [];
  }

  function fallSeconds() {
    return Math.max(3.6, 6.5 - score * 0.2);
  }

  function floorY() {
    return gameStage.clientHeight - gameFloorEl.offsetHeight + 2;
  }

  function startRound() {
    if (finished || over) return;
    clearBalloons();
    round++;
    renderStats();

    let pick;
    do {
      pick = GAME_WORDS[Math.floor(Math.random() * GAME_WORDS.length)];
    } while (pick[0] === lastSpanish);
    lastSpanish = pick[0];
    target = pick;
    gameTargetEl.textContent = pick[0];
    gameTargetEl.classList.remove("pulse");
    void gameTargetEl.offsetWidth;
    gameTargetEl.classList.add("pulse");

    const distractors = shuffled(GAME_WORDS.filter((w) => w[1] !== pick[1]))
      .slice(0, GAME_LANES - 1)
      .map((w) => w[1]);
    const labels = shuffled([pick[1], ...distractors]);
    const lanes = shuffled([...Array(GAME_LANES).keys()]);
    const colors = shuffled(BALLOON_COLORS);
    const baseSpeed = (gameStage.clientHeight + 120) / fallSeconds();

    labels.forEach((label, i) => {
      const color = colors[i];
      const el = document.createElement("button");
      el.type = "button";
      el.className = "game-balloon";
      el.setAttribute("aria-label", label);
      el.innerHTML =
        '<span class="balloon-sway"><span class="balloon-body"><span class="balloon-label"></span></span>' +
        '<span class="balloon-string"></span></span>';
      el.querySelector(".balloon-label").textContent = label;
      el.style.left = `${((lanes[i] + 0.5) / GAME_LANES) * 100}%`;
      el.style.setProperty("--b1", color.light);
      el.style.setProperty("--b2", color.main);
      el.style.setProperty("--b3", color.dark);
      el.style.setProperty("--sway-delay", `-${(Math.random() * 3).toFixed(2)}s`);
      gameStage.appendChild(el);

      const b = {
        el,
        color,
        correct: label === pick[1],
        bodyH: el.querySelector(".balloon-body").offsetHeight,
        y: -el.offsetHeight - i * 40,
        speed: baseSpeed * (0.9 + Math.random() * 0.25),
        done: false,
      };
      el.style.transform = `translate(-50%, ${b.y}px)`;
      el.addEventListener("click", () => hit(b));
      balloons.push(b);
    });
    roundActive = true;
  }

  function advance() {
    if (round >= GAME_ROUNDS) gameOver();
    else startRound();
  }

  function endRound(holdMs) {
    roundActive = false;
    later(() => {
      balloons.forEach((b) => {
        if (!b.done) b.el.classList.add("fade");
      });
    }, holdMs);
    later(advance, holdMs + 400);
  }

  function shakeBoard() {
    gameStageWrap.classList.remove("hurt");
    void gameStageWrap.offsetWidth;
    gameStageWrap.classList.add("hurt");
  }

  // Wrong answer or missed balloon: light up the right one, dim and freeze the rest.
  function revealAnswer() {
    balloons.forEach((b) => {
      if (!b.done) b.el.classList.add(b.correct ? "reveal" : "dim");
    });
  }

  function bodyCentre(b) {
    return { x: b.el.offsetLeft, y: b.y + b.bodyH / 2 };
  }

  function hit(b) {
    if (finished || over || !roundActive || b.done) return;
    b.done = true;
    const { x, y } = bodyCentre(b);
    b.el.remove();
    if (b.correct) {
      burst(x, y, b.color, "POP!");
      score++;
      renderStats(true);
      gameFeedbackEl.textContent = ["¡Correcto!", "¡Perfecto!", "¡Muy bien!", "¡Genial!"][score % 4];
      endRound(250);
    } else {
      burst(x, y, b.color, "✕");
      gameFeedbackEl.textContent = `¡Casi! Era "${target[1]}"`;
      shakeBoard();
      roundActive = false;
      revealAnswer();
      endRound(1300);
    }
  }

  function spikeFlash() {
    gameFloorEl.classList.remove("flash");
    void gameFloorEl.offsetWidth;
    gameFloorEl.classList.add("flash");
  }

  function tick(ts) {
    if (finished) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (roundActive && !over) {
      const floor = floorY();
      for (const b of balloons) {
        if (b.done) continue;
        b.y += b.speed * dt;
        b.el.style.transform = `translate(-50%, ${b.y}px)`;
        if (b.y + b.bodyH >= floor) {
          b.done = true;
          const { x } = bodyCentre(b);
          b.el.remove();
          burst(x, floor - 10, b.color, b.correct ? "POP!" : "");
          spikeFlash();
          if (b.correct) {
            gameFeedbackEl.textContent = `Era "${target[1]}"`;
            shakeBoard();
            roundActive = false;
            revealAnswer();
            endRound(900);
            break;
          }
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function gameOver() {
    over = true;
    roundActive = false;
    clearBalloons();
    gameFinalScoreEl.textContent = `${score} / ${GAME_ROUNDS}`;
    gameOverEl.classList.remove("hidden");
  }

  function resetGame() {
    score = 0;
    round = 0;
    over = false;
    lastSpanish = null;
    gameFeedbackEl.textContent = "";
    gameOverEl.classList.add("hidden");
    renderStats();
    startRound();
  }

  function showReady() {
    gameStatusEl.classList.add("hidden");
    gameReadyBtn.classList.remove("hidden");
  }

  gameStatusEl.classList.remove("hidden");
  gameReadyBtn.classList.add("hidden");
  gameReadyBtn.onclick = () => finish(false);
  gameAgainBtn.onclick = resetGame;
  quizSkip.onclick = () => finish(true);
  gameMuteBtn.textContent = soundOn ? "Sound on" : "Sound off";
  gameMuteBtn.onclick = () => {
    soundOn = !soundOn;
    gameMuteBtn.textContent = soundOn ? "Sound on" : "Sound off";
    try {
      localStorage.setItem("sbSound", soundOn ? "on" : "off");
    } catch (e) {}
  };

  quizOverlay.classList.remove("hidden");
  renderStats();
  gameFeedbackEl.textContent = "";
  gameOverEl.classList.add("hidden");
  rafId = requestAnimationFrame((ts) => {
    lastTs = ts;
    startRound();
    rafId = requestAnimationFrame(tick);
  });

  return {
    notifyReady() {
      if (!finished) showReady();
    },
  };
}

// ---------- Submission flow ----------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  errorBox.classList.add("hidden");
  errorBox.textContent = "";

  const name = document.getElementById("name").value.trim();
  const studentClass = document.getElementById("class").value;
  const fileInput = document.getElementById("audio");

  if (!fileInput.files.length) return;

  lastStudentName = name;

  const fd = new FormData();
  fd.append("name", name);
  fd.append("class", studentClass);
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

  const game = runGame(async (skipped) => {
    if (skipped) {
      progress.classList.remove("hidden");
      const timer = cyclePlaceholderProgress(photoInput.files.length > 0);
      await gradingPromise;
      clearInterval(timer);
      progress.classList.add("hidden");
    }
    showResultOrError();
  });
  gradingPromise.then(() => game.notifyReady());
});

// Print route: the browser's "Save as PDF" keeps text selectable and wraps lines cleanly.
// style.css @media print hides everything except #result. The document title becomes the file name.
downloadBtn.addEventListener("click", () => {
  const safeName = (lastStudentName || "student").replace(/[^a-z0-9]+/gi, "_");
  const originalTitle = document.title;
  document.title = `SpeakBack_${safeName}`;
  window.addEventListener("afterprint", () => { document.title = originalTitle; }, { once: true });
  window.print();
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
