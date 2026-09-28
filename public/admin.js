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

async function loadSubmissions() {
  const res = await fetch("/admin/api/submissions");
  const rows = await res.json();

  submissionsBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = "row-link";
    tr.innerHTML = `
      <td>${escapeHtml(row.student_name)}</td>
      <td><span class="pill">${escapeHtml(row.student_class)}</span></td>
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
    <h3>Feedback</h3>
    <div>${marked.parse(row.feedback)}</div>
    <h3>Transcript</h3>
    <div>${marked.parse(row.transcript)}</div>
  `;
  detailCard.scrollIntoView({ behavior: "smooth" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

checkSession();
