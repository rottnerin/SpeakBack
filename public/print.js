// Print layout: rebuilds the rendered feedback into a readable PDF sheet.
// Page 1 = name/date, big marks, strengths, recommendations. Then the detailed sections.
// Works only from the rendered DOM (headings are matched by keyword), so the prompt and rubric
// are untouched. If anything can't be recognised, that content just prints in its original order.

(function () {
  const FRONT = [
    { key: "strengths", re: /strength|fortaleza|success/i },
    { key: "recommendations", re: /recommend|recomend/i },
  ];
  const DETAIL = [
    { key: "breakdown", re: /breakdown|desglose/i },
    { key: "corrections", re: /correction|grow|correcci/i },
    { key: "scoring", re: /rubric|scoring|puntuaci/i },
    { key: "study", re: /study|material/i },
  ];
  const SUMMARY_RE = /score summary|summary|resumen/i;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Split the rendered feedback into { preamble, sections:[{title, nodes}] } at the section heading level.
  function sectionize(root) {
    const kids = Array.from(root.children);
    const level = ["H2", "H3", "H1"].find((h) => kids.some((k) => k.tagName === h));
    const preamble = [];
    const sections = [];
    let cur = null;
    for (const k of kids) {
      if (level && k.tagName === level) {
        cur = { title: k.textContent.trim(), nodes: [] };
        sections.push(cur);
      } else if (cur) {
        cur.nodes.push(k);
      } else {
        preamble.push(k);
      }
    }
    return { preamble, sections };
  }

  // Marks from the score-summary table: rows containing "x/12", "x/6", "x/18".
  function readScores(sections) {
    const sec = sections.find((s) => SUMMARY_RE.test(s.title)) || sections.find((s) => s.nodes.some((n) => n.tagName === "TABLE"));
    if (!sec) return null;
    const table = sec.nodes.find((n) => n.tagName === "TABLE");
    if (!table) return null;
    const cards = [];
    for (const tr of table.querySelectorAll("tr")) {
      const cells = Array.from(tr.children).map((c) => c.textContent.trim());
      const m = (cells[1] || cells.join(" ")).match(/(\d+(?:\.\d+)?)\s*\/\s*(12|6|18|30)\b/);
      if (!m) continue;
      cards.push({ label: cells[0], mark: m[1], out: m[2], level: m[2] === "18" || m[2] === "30" ? "" : cells[2] || "" });
    }
    return cards.length >= 2 ? { cards, table, sec } : null;
  }

  function scoreStrip(cards) {
    const strip = el("div", "ps-scores");
    for (const c of cards) {
      const card = el("div", "ps-card" + ((c.out === "18" || c.out === "30") ? " ps-total" : ""));
      card.appendChild(el("div", "ps-card-label", c.label));
      const big = el("div", "ps-card-mark", c.mark);
      big.appendChild(el("span", null, "/" + c.out));
      card.appendChild(big);
      if (c.level) card.appendChild(el("div", "ps-card-level", c.level));
      strip.appendChild(card);
    }
    return strip;
  }

  function addSection(parent, title, nodes, cls) {
    const s = el("section", "ps-section" + (cls ? " " + cls : ""));
    s.appendChild(el("h2", null, title.replace(/^\s*\d+[.)]\s*/, "")));
    nodes.forEach((n) => s.appendChild(n));
    parent.appendChild(s);
    return s;
  }

  window.buildPrintSheet = function (resultEl, sheetEl, studentName) {
    sheetEl.textContent = "";
    const root = resultEl.cloneNode(true);
    const { preamble, sections } = sectionize(root);

    // Disclaimer: pulled out of the body, shown once as a small note.
    let disclaimer = null;
    const keep = [];
    for (const n of preamble) {
      if (!disclaimer && /informative purposes|does not represent/i.test(n.textContent)) disclaimer = n;
      else keep.push(n);
    }

    const head = el("header", "ps-head");
    head.appendChild(el("div", "ps-kicker", "SpeakBack · Spanish oral practice"));
    head.appendChild(el("h1", null, "Your feedback" + (studentName ? " — " + studentName : "")));
    head.appendChild(el("div", "ps-date", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })));
    sheetEl.appendChild(head);

    const scores = readScores(sections);
    if (scores) {
      sheetEl.appendChild(scoreStrip(scores.cards));
      const leftover = scores.sec.nodes.filter((n) => n !== scores.table);
      if (leftover.length) {
        const note = el("div", "ps-note");
        leftover.forEach((n) => note.appendChild(n.cloneNode(true)));
        sheetEl.appendChild(note);
      }
    }

    // Page 1 "at a glance": copies of the top fix, the target and a few strengths.
    const glance = el("div", "ps-glance");
    const strengths = sections.find((s) => FRONT[0].re.test(s.title));
    const recs = sections.find((s) => FRONT[1].re.test(s.title));
    const picks = [];
    if (recs) {
      for (const n of recs.nodes) {
        if (/^\s*(target|the single highest|single highest|highest-leverage)/i.test(n.textContent)) picks.push(n.cloneNode(true));
      }
    }
    if (picks.length) addSection(glance, "Your next step", picks);
    const bullets = strengths && strengths.nodes.find((n) => n.tagName === "UL" || n.tagName === "OL");
    if (bullets) {
      const ul = bullets.cloneNode(false);
      Array.from(bullets.children).slice(0, 3).forEach((li) => ul.appendChild(li.cloneNode(true)));
      addSection(glance, "What you did well", [ul]);
    }
    if (glance.children.length) sheetEl.appendChild(glance);

    // Everything below is the complete feedback, every section in its original order.
    sheetEl.appendChild(el("div", "ps-divider", "Full feedback"));
    keep.forEach((n) => sheetEl.appendChild(n));
    sections.forEach((s) => addSection(sheetEl, s.title, s.nodes));

    if (disclaimer) {
      const d = el("div", "ps-disclaimer");
      d.innerHTML = disclaimer.innerHTML;
      sheetEl.appendChild(d);
    }
  };
})();
