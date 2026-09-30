const loginCard = document.getElementById("login-card");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const dashboard = document.getElementById("dashboard");
const logoutBtn = document.getElementById("logout-btn");
const submissionsBody = document.getElementById("submissions-body");
const detailCard = document.getElementById("detail-card");
const detailContent = document.getElementById("detail-content");

async function checkSession() {
  const res = await fetch("/admin/api/session");
  const data = await res.json();
  if (data.isAdmin) {
    showDashboard();
  }
}

function showDashboard() {
  loginCard.classList.add("hidden");
  dashboard.classList.remove("hidden");
  loadSubmissions();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    loginError.textContent = data.error || "Login failed.";
    loginError.classList.remove("hidden");
    return;
  }
  showDashboard();
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST" });
  dashboard.classList.add("hidden");
  loginCard.classList.remove("hidden");
});

const PILL_VARIANTS = [
  "pill-strategic",
  "pill-conceptual",
  "pill-critical",
  "pill-dialogic",
  "pill-reflective",
  "pill-design",
];

function pillVariantFor(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return PILL_VARIANTS[Math.abs(hash) % PILL_VARIANTS.length];
}

async function loadSubmissions() {
  const res = await fetch("/admin/api/submissions");
  const rows = await res.json();

  submissionsBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "row-link";
    tr.innerHTML = `
      <td>${escapeHtml(row.student_name)}</td>
      <td><span class="pill ${pillVariantFor(row.student_class)}">${escapeHtml(row.student_class)}</span></td>
      <td>${new Date(row.created_at + "Z").toLocaleString()}</td>
    `;
    tr.addEventListener("click", () => loadDetail(row.id));
    submissionsBody.appendChild(tr);
  });
}

async function loadDetail(id) {
  const res = await fetch(`/admin/api/submissions/${id}`);
  const row = await res.json();
  if (!res.ok) return;

  detailCard.classList.remove("hidden");
  detailContent.innerHTML = `
    <h2>${escapeHtml(row.student_name)} — ${escapeHtml(row.student_class)}</h2>
    <p class="hint">${new Date(row.created_at + "Z").toLocaleString()}</p>
    ${renderAgreement(row.agreement)}
    <h3>Feedback</h3>
    <div>${marked.parse(row.feedback)}</div>
    <h3>Transcript</h3>
    <div>${marked.parse(row.transcript)}</div>
  `;
  detailCard.scrollIntoView({ behavior: "smooth" });
}

// The two graders scored the same performance independently. Where they diverged is where the
// final score was a judgement call rather than a reading — that's what's worth a human look.
const CRITERIA = [
  ["A", "A — Language", 12],
  ["B1", "B1 — Photo", 6],
  ["B2", "B2 — Conversation", 6],
  ["C", "C — Interaction", 6],
];

function renderAgreement(agreement) {
  if (!agreement) return "";

  const rows = CRITERIA.map(([key, label, max]) => {
    const gap = Math.abs(agreement.audio[key] - agreement.transcript[key]);
    const flag = gap >= 2 ? ' class="gap-wide"' : gap === 1 ? ' class="gap-slim"' : "";
    return `<tr${flag}>
      <td>${label}</td>
      <td>${agreement.audio[key]}</td>
      <td>${agreement.transcript[key]}</td>
      <td><strong>${agreement.final[key]}</strong> / ${max}</td>
    </tr>`;
  }).join("");

  const widest = Math.max(
    ...CRITERIA.map(([key]) => Math.abs(agreement.audio[key] - agreement.transcript[key]))
  );

  return `
    <h3>Grader agreement ${widest >= 2 ? "— worth reviewing" : ""}</h3>
    <p class="hint">Audio-only and transcript-only graders scored independently; the final column is
    the reconciled score. Highlighted rows are where they disagreed.</p>
    <table class="agreement-table">
      <tr><th>Criterion</th><th>From audio</th><th>From transcript</th><th>Final</th></tr>
      ${rows}
      <tr><td><strong>Total</strong></td><td>${agreement.audio.total}</td><td>${agreement.transcript.total}</td><td><strong>${agreement.final.total}</strong> / 30</td></tr>
    </table>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

checkSession();
