(function () {
  const field = document.createElement("div");
  field.className = "hex-field";
  field.setAttribute("aria-hidden", "true");
  document.body.prepend(field);

  const DEFAULTS = {
    hexW: 32,
    hexH: 33,
    colorAlpha: 0.55,
    opMin: 0.64,
    opMax: 0.79,
    shineOp: 0.23,
    radius: 80,
    brightness: 1.1,
    saturate: 0.5,
  };

  const HUES = [
    [59, 169, 133],
    [122, 106, 232],
    [79, 170, 203],
  ];

  const state = { ...DEFAULTS };

  let hexes = [];

  function colorAt(i) {
    const [r, g, b] = HUES[i % HUES.length];
    return `rgba(${r},${g},${b},${state.colorAlpha})`;
  }

  function applyCssVars() {
    const root = document.documentElement.style;
    root.setProperty("--hex-w", state.hexW + "px");
    root.setProperty("--hex-h", state.hexH + "px");
    root.setProperty("--hex-op-min", state.opMin);
    root.setProperty("--hex-op-max", state.opMax);
    root.setProperty("--hex-shine-op", state.shineOp);
    root.setProperty("--hex-brightness", state.brightness);
    root.setProperty("--hex-saturate", state.saturate);
  }

  function buildGrid() {
    field.innerHTML = "";
    hexes = [];
    const cols = Math.ceil(window.innerWidth / (state.hexW * 0.85)) + 2;
    const rows = Math.ceil(window.innerHeight / (state.hexH * 0.9)) + 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * state.hexW * 0.85 - state.hexW;
        const y = r * state.hexH * 0.9 + (c % 2 ? state.hexH * 0.45 : 0) - state.hexH;

        const el = document.createElement("div");
        el.className = "hex";
        el.style.left = x + "px";
        el.style.top = y + "px";
        el.style.setProperty("--delay", (Math.random() * 6).toFixed(2) + "s");
        el.style.setProperty("--shine", "0");
        el.style.background = `radial-gradient(circle at 35% 30%, ${colorAt(r + c)}, transparent 70%)`;

        field.appendChild(el);
        hexes.push({ el, cx: x + state.hexW / 2, cy: y + state.hexH / 2 });
      }
    }
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  applyCssVars();
  buildGrid();
  window.addEventListener("resize", debounce(buildGrid, 250));

  let active = new Set();
  let ticking = false;
  let mouseX = -9999;
  let mouseY = -9999;

  function updateShine() {
    ticking = false;
    const stillActive = new Set();

    for (const h of hexes) {
      const dx = h.cx - mouseX;
      const dy = h.cy - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < state.radius) {
        const intensity = 1 - dist / state.radius;
        h.el.style.setProperty("--shine", intensity.toFixed(2));
        h.el.setAttribute("data-shine", "");
        stillActive.add(h.el);
      }
    }

    for (const el of active) {
      if (!stillActive.has(el)) {
        el.style.setProperty("--shine", "0");
        el.removeAttribute("data-shine");
      }
    }
    active = stillActive;
  }

  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateShine);
    }
  });

  // ---------- Public API + dev control panel ----------

  const HexField = {
    state,
    set(key, value) {
      state[key] = value;
      applyCssVars();
      if (key === "hexW" || key === "hexH") buildGrid();
      if (key === "colorAlpha") buildGrid();
    },
    reset() {
      Object.assign(state, DEFAULTS);
      applyCssVars();
      buildGrid();
    },
  };
  window.HexField = HexField;

  const isDev =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    new URLSearchParams(location.search).has("hexdebug");

  if (!isDev) return;

  const CONTROLS = [
    { key: "hexW", label: "Hex width", min: 20, max: 90, step: 1, unit: "px" },
    { key: "hexH", label: "Hex height", min: 16, max: 80, step: 1, unit: "px" },
    { key: "colorAlpha", label: "Color intensity", min: 0.05, max: 0.9, step: 0.01 },
    { key: "opMin", label: "Base opacity (min)", min: 0, max: 1, step: 0.01 },
    { key: "opMax", label: "Base opacity (max)", min: 0, max: 1, step: 0.01 },
    { key: "radius", label: "Shimmer radius", min: 60, max: 500, step: 5, unit: "px" },
    { key: "shineOp", label: "Shimmer opacity boost", min: 0, max: 1, step: 0.01 },
    { key: "brightness", label: "Shimmer brightness", min: 0, max: 5, step: 0.1 },
    { key: "saturate", label: "Shimmer saturation", min: 0, max: 3, step: 0.1 },
  ];

  function buildPanel() {
    const panel = document.createElement("div");
    panel.className = "hexdev-panel";

    const title = document.createElement("h3");
    title.innerHTML = "Hex field <span></span>";
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = "hide";
    title.querySelector("span").replaceWith(toggleBtn);
    panel.appendChild(title);

    const body = document.createElement("div");
    panel.appendChild(body);

    CONTROLS.forEach((c) => {
      const row = document.createElement("div");
      row.className = "hexdev-row";

      const label = document.createElement("label");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = c.label;
      const out = document.createElement("output");
      out.textContent = state[c.key];
      label.appendChild(nameSpan);
      label.appendChild(out);

      const input = document.createElement("input");
      input.type = "range";
      input.min = c.min;
      input.max = c.max;
      input.step = c.step;
      input.value = state[c.key];

      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        out.textContent = c.unit ? `${v}${c.unit}` : v;
        HexField.set(c.key, v);
      });

      row.appendChild(label);
      row.appendChild(input);
      body.appendChild(row);
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "hexdev-reset";
    resetBtn.textContent = "Reset to defaults";
    resetBtn.addEventListener("click", () => {
      HexField.reset();
      body.querySelectorAll(".hexdev-row").forEach((row, i) => {
        const c = CONTROLS[i];
        const input = row.querySelector("input");
        const out = row.querySelector("output");
        input.value = state[c.key];
        out.textContent = c.unit ? `${state[c.key]}${c.unit}` : state[c.key];
      });
    });
    body.appendChild(resetBtn);

    let collapsed = false;
    toggleBtn.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "";
      toggleBtn.textContent = collapsed ? "show" : "hide";
    });

    document.body.appendChild(panel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildPanel);
  } else {
    buildPanel();
  }
})();
