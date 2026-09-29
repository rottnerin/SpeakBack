(function () {
  const field = document.createElement("div");
  field.className = "hex-field";
  field.setAttribute("aria-hidden", "true");
  document.body.prepend(field);

  const HEX_W = 46;
  const HEX_H = 40;
  const COLORS = [
    "rgba(79,198,162,.14)",
    "rgba(154,142,240,.14)",
    "rgba(110,193,228,.14)",
  ];

  let hexes = [];

  function buildGrid() {
    field.innerHTML = "";
    hexes = [];
    const cols = Math.ceil(window.innerWidth / (HEX_W * 0.85)) + 2;
    const rows = Math.ceil(window.innerHeight / (HEX_H * 0.9)) + 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * HEX_W * 0.85 - HEX_W;
        const y = r * HEX_H * 0.9 + (c % 2 ? HEX_H * 0.45 : 0) - HEX_H;

        const el = document.createElement("div");
        el.className = "hex";
        el.style.left = x + "px";
        el.style.top = y + "px";
        el.style.setProperty("--delay", (Math.random() * 6).toFixed(2) + "s");
        el.style.setProperty("--shine", "0");
        const color = COLORS[(r + c) % COLORS.length];
        el.style.background = `radial-gradient(circle at 35% 30%, ${color}, transparent 70%)`;

        field.appendChild(el);
        hexes.push({ el, cx: x + HEX_W / 2, cy: y + HEX_H / 2 });
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

  buildGrid();
  window.addEventListener("resize", debounce(buildGrid, 250));

  const RADIUS = 170;
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

      if (dist < RADIUS) {
        const intensity = 1 - dist / RADIUS;
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
})();
