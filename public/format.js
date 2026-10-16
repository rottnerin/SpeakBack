// Screen layout for the feedback: marks in one row of cards, then one row per section with the
// heading in a side column. Same words as the raw feedback; only position and emphasis change.
// Works from the rendered DOM (headings matched by keyword), like print.js. If anything cannot be
// recognised it returns false and the plain feedback stays visible.

(function () {
  const KEYS = [
    ["summary", /score summary|summary|resumen/i],
    ["breakdown", /breakdown|desglose/i],
    ["strengths", /strength|fortaleza|success/i],
    ["corrections", /correction|grow|correcci/i],
    ["scoring", /rubric|scoring|puntuaci/i],
    ["recs", /recommend|recomend/i],
    ["study", /study|material/i],
  ];
  const LABELS = {
    breakdown: "Your description, step by step",
    strengths: "What worked",
    corrections: "Fix these",
    scoring: "Where the marks come from",
    recs: "Your plan",
    study: "Class material",
  };

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // Gemini is not consistent about the section heading level (## one time, ### the next), so use the
  // level that carries the known section names.
  function sectionLevel(root) {
    const kids = Array.from(root.children);
    const hits = (tag) =>
      kids.filter((k) => k.tagName === tag && KEYS.some(([, re]) => re.test(k.textContent))).length;
    return ["H2", "H3", "H1"].find((h) => hits(h) >= 3) || null;
  }

  function parse(root, level) {
    const pre = [];
    const secs = [];
    let cur = null;
    for (const k of Array.from(root.children)) {
      if (k.tagName === level) {
        cur = { title: k.textContent.trim(), nodes: [], key: "other" };
        for (const [key, re] of KEYS) if (cur.key === "other" && re.test(cur.title)) cur.key = key;
        secs.push(cur);
      } else if (cur) cur.nodes.push(k);
      else pre.push(k);
    }
    return { pre, secs };
  }

  function readMarks(sec) {
    const table = sec && sec.nodes.find((n) => n.tagName === "TABLE");
    if (!table) return null;
    const cards = [];
    for (const tr of table.querySelectorAll("tr")) {
      const cells = Array.from(tr.children).map((c) => c.textContent.trim());
      const m = (cells[1] || "").match(/(\d+(?:\.\d+)?)\s*\/\s*(12|6|18|30)\b/);
      if (!m) continue;
      const total = m[2] === "18" || m[2] === "30";
      cards.push({
        label: total ? "Total" : cells[0].replace(/^Criterion\s*/i, "").replace(/\s*[—:-]\s*/, ": "),
        mark: Number(m[1]),
        out: Number(m[2]),
        word: total ? "" : cells[2] || "",
        total,
      });
    }
    return cards.length >= 2 ? { cards, table } : null;
  }

  function markCards(cards) {
    const wrap = el("div", "fv-cards");
    for (const c of cards) {
      const d = el("div", "fv-mk" + (c.total ? " fv-tot" : ""));
      d.appendChild(el("div", "fv-n", null)).textContent = c.label;
      const v = el("div", "fv-v");
      v.textContent = String(c.mark);
      v.appendChild(el("small", null)).textContent = "/" + c.out;
      d.appendChild(v);
      d.appendChild(el("div", "fv-trk", '<i style="width:' + Math.round((100 * c.mark) / c.out) + '%"></i>'));
      if (c.word) d.appendChild(el("div", "fv-w", null)).textContent = c.word;
      wrap.appendChild(d);
    }
    return wrap;
  }

  // Corrections table: error column red, fix column green, grammar tag muted.
  function tweakTables(root) {
    for (const t of root.querySelectorAll("table")) {
      const heads = Array.from(t.querySelectorAll("th")).map((h) => h.textContent.toLowerCase());
      const wrong = heads.findIndex((h) => /frase|said|student/.test(h));
      const right = heads.findIndex((h) => /correcc|try|suggest/.test(h));
      const tag = heads.findIndex((h) => /regla|rule|enfoque/.test(h));
      for (const tr of t.querySelectorAll("tr")) {
        const td = tr.querySelectorAll("td");
        if (wrong > -1 && td[wrong]) td[wrong].classList.add("fv-wrong");
        if (right > -1 && td[right]) td[right].classList.add("fv-right");
        if (tag > -1 && td[tag]) td[tag].classList.add("fv-tag");
      }
      const w = el("div", "fv-tw");
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    }
  }

  // Spanish the student said, shown in the accent colour. Text nodes only, so no markup is touched.
  function highlightQuotes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let n;
    while ((n = walker.nextNode())) {
      if (/[“"][^”"]{2,}[”"]/.test(n.nodeValue) && !n.parentNode.closest("button, .fv-q")) hits.push(n);
    }
    for (const t of hits) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const re = /[“"][^”"]{2,}[”"]/g;
      let m;
      while ((m = re.exec(t.nodeValue))) {
        frag.appendChild(document.createTextNode(t.nodeValue.slice(last, m.index)));
        const s = el("span", "fv-q");
        s.textContent = m[0];
        frag.appendChild(s);
        last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(t.nodeValue.slice(last)));
      t.parentNode.replaceChild(frag, t);
    }
  }

  function critBlocks(nodes, subTag) {
    const box = el("div", "fv-body");
    let cur = null;
    for (const n of nodes) {
      if (n.tagName === subTag) {
        cur = el("div", "fv-crit");
        cur.appendChild(n);
        box.appendChild(cur);
      } else (cur || box).appendChild(n);
    }
    return box;
  }

  window.buildFeedbackView = function (resultEl, viewEl) {
    try {
      viewEl.textContent = "";
      const root = resultEl.cloneNode(true);
      const level = sectionLevel(root);
      if (!level) return false;
      const { pre, secs } = parse(root, level);
      const subTag = level === "H1" ? "H2" : level === "H2" ? "H3" : "H4";

      let disclaimer = null;
      const others = [];
      for (const n of pre) {
        if (!disclaimer && /informative purposes|does not represent/i.test(n.textContent)) disclaimer = n;
        else others.push(n);
      }

      const marks = readMarks(secs.find((s) => s.key === "summary") || secs.find((s) => s.nodes.some((n) => n.tagName === "TABLE")));

      const head = el("header", "fv-head");
      head.appendChild(el("div", "fv-kicker", "SpeakBack · Spanish oral practice"));
      head.appendChild(el("h1", null, "Your feedback"));
      if (marks) head.appendChild(markCards(marks.cards));
      viewEl.appendChild(head);

      for (const s of secs) {
        let nodes = s.nodes.filter((n) => n.tagName !== "HR");
        if (marks && s.nodes.includes(marks.table)) {
          // the table is now the cards; keep any sentence that followed it as a small note
          const note = nodes.filter((n) => n !== marks.table && n.textContent.trim());
          if (note.length) {
            const d = el("div", "fv-note");
            note.forEach((n) => d.appendChild(n));
            head.appendChild(d);
          }
          continue;
        }
        const row = el("section", "fv-row");
        const h = el("h2");
        h.textContent = s.title.replace(/^\s*\d+[.)]\s*/, "");
        if (LABELS[s.key]) h.appendChild(el("span", null)).textContent = LABELS[s.key];
        row.appendChild(h);
        let body;
        if (s.key === "scoring") body = critBlocks(nodes, subTag);
        else {
          body = el("div", "fv-body");
          nodes.forEach((n) => body.appendChild(n));
        }
        if (s.key === "recs") {
          for (const n of body.children) {
            if (/^\s*(target|the single highest|single highest)/i.test(n.textContent)) n.classList.add("fv-callout");
          }
        }
        const holder = el("div", s.key === "corrections" || s.key === "scoring" ? "fv-panel" : null);
        holder.appendChild(body);
        row.appendChild(holder);
        viewEl.appendChild(row);
      }

      others.forEach((n) => viewEl.appendChild(n));
      tweakTables(viewEl);
      highlightQuotes(viewEl);
      if (disclaimer) {
        const d = el("div", "fv-disc");
        d.innerHTML = disclaimer.innerHTML;
        viewEl.appendChild(d);
      }
      return true;
    } catch (err) {
      console.error("Feedback layout failed, showing plain feedback:", err);
      viewEl.textContent = "";
      return false;
    }
  };
})();
