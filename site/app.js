(() => {
  "use strict";

  const DATA = window.MQA_DATA;
  const LETTERS = "ABCDEFGH";
  const FRACTIONS = [
    { v: 0.25, t: "¼" }, { v: 0.5, t: "½" }, { v: 0.75, t: "¾" }, { v: 1, t: "1" },
    { v: 1.5, t: "1½" }, { v: 2, t: "2" }, { v: 3, t: "3" },
  ];
  const MEASURE_FRACTIONS = ["¼", "½", "¾", "1"];
  const MEAL_PRESETS = ["Pequeno-almoço", "Meio da manhã", "Almoço", "Lanche", "Jantar", "Ceia"];
  // índices em cada linha de s.nutrition (ordem da Tabela 3 do manual)
  const N = { kcal: 0, prot: 1, hc: 2, acu: 3, gord: 4, ags: 5, fibra: 6 };

  // Observações sobre valores do manual que parecem gralhas (mantidos tal como no original).
  const NOTES = {
    MQA020: "No manual, o peso total da foto B (60 g) é inferior ao peso edível (95 g); provável gralha — na série MQA021 o valor é 96 g.",
    MQA031: "No manual, o peso total da foto B (142 g) parece ser uma gralha: o peso edível correspondente é 20 g.",
    MQA032: "No manual, o peso total da foto B (200 g) parece ser uma gralha: o peso edível correspondente é 20 g.",
    MQA108: "O manual apresenta 6 porções nas tabelas (A–F), mas só 5 fotografias (A–E).",
    MQA062: "Nesta série cada fotografia mostra um tipo/fatia de pão diferente, por isso os pesos não são crescentes.",
    MQA062B: "Nesta série cada fotografia mostra um tipo de pão diferente, por isso os pesos não são crescentes.",
    MQA062C: "Nesta série os pedaços têm formatos diferentes, por isso os pesos não são estritamente crescentes.",
  };

  const $main = document.getElementById("main");
  const $q = document.getElementById("q");
  const $clear = document.getElementById("clear");
  const $zoom = document.getElementById("zoom");
  const $toast = document.getElementById("toast");
  const $badge = document.getElementById("meal-badge");

  const byCode = new Map(DATA.series.map((s) => [s.code, s]));
  const measureByCode = new Map(DATA.measures.map((m) => [m.code, m]));

  // ------------------------------------------------------------------ util
  const nf0 = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const grams = (v) => (v < 10 && v % 1 ? nf1.format(v) : nf0.format(v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const parseNum = (v) => Number(String(v).trim().replace(",", "."));
  const fracLabel = (m) => FRACTIONS.find((f) => f.v === m)?.t ?? nf1.format(m).replace(/,0$/, "");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* armazenamento indisponível */ }
    },
  };
  const favs = new Set(store.get("mqa:favs", []));
  let recent = store.get("mqa:recent", []);
  let infoDismissed = store.get("mqa:info-dismissed", false);

  function toggleFav(code) {
    favs.has(code) ? favs.delete(code) : favs.add(code);
    store.set("mqa:favs", [...favs]);
  }
  function pushRecent(code) {
    recent = [code, ...recent.filter((c) => c !== code)].slice(0, 12);
    store.set("mqa:recent", recent);
  }

  // ------------------------------------------------------------------ refeições (estado)
  /**
   * Carrega as refeições. Versões anteriores tinham uma refeição "atual" (mqa:meal) e cópias
   * guardadas (mqa:meals); a atual é fundida na lista e a chave antiga é removida.
   */
  function loadMeals() {
    const clean = (items) => (items || []).filter((it) => byCode.has(it.code));
    const list = store.get("mqa:meals", []).map((m) => ({ id: m.id || uid(), name: m.name || "", items: clean(m.items) }));
    const legacy = store.get("mqa:meal", null);
    if (legacy?.items?.length) {
      const existing = list.find((m) => m.id === legacy.savedId);
      if (existing) Object.assign(existing, { name: legacy.name || existing.name, items: clean(legacy.items) });
      else list.unshift({ id: uid(), name: legacy.name || "Refeição", items: clean(legacy.items) });
    }
    store.remove("mqa:meal");
    return list;
  }
  let meals = loadMeals();
  let activeId = store.get("mqa:active-meal", null);
  if (!meals.some((m) => m.id === activeId)) activeId = meals[0]?.id ?? null;

  const mealById = (id) => meals.find((m) => m.id === id);
  const activeMeal = () => mealById(activeId) ?? null;
  const mealName = (m) => m.name.trim() || "Refeição sem nome";

  function saveMeals() {
    store.set("mqa:meals", meals);
    store.set("mqa:active-meal", activeId);
    updateBadge();
  }
  function updateBadge() {
    const n = meals.reduce((acc, m) => acc + m.items.length, 0);
    $badge.hidden = !n;
    $badge.textContent = n;
  }

  /** "Almoço", ou "Almoço 2" se já existir. */
  function uniqueName(base) {
    const names = new Set(meals.map((m) => m.name.trim()));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }
  /** Nome sugerido pela hora do dia. */
  function defaultMealName() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const base = h < 10.5 ? "Pequeno-almoço" : h < 12 ? "Meio da manhã" : h < 15 ? "Almoço" : h < 18.5 ? "Lanche" : h < 22 ? "Jantar" : "Ceia";
    return uniqueName(base);
  }
  function createMeal(name = defaultMealName()) {
    const meal = { id: uid(), name, items: [] };
    meals.push(meal);
    activeId = meal.id;
    saveMeals();
    return meal;
  }

  /** Letra → caminho da foto (algumas séries têm menos fotos do que linhas na tabela). */
  function photoOf(s, letter) {
    const i = s.letters.indexOf(letter);
    return i < 0 ? null : s.photos[i];
  }
  const rowLetters = (s) => LETTERS.slice(0, s.total.length).split("");
  const defaultLetter = (s) => (rowLetters(s).includes("C") ? "C" : rowLetters(s)[0]);
  /** Foto cujo peso total está mais próximo de `g` (referência visual no modo gramas). */
  function closestLetter(s, g) {
    let best = 0;
    s.total.forEach((t, i) => { if (Math.abs(t - g) < Math.abs(s.total[best] - g)) best = i; });
    return LETTERS[best];
  }

  /** Pesos e nutrientes de `mult` × foto `letter`. */
  function portion(s, letter, mult) {
    const i = rowLetters(s).indexOf(letter);
    return {
      total: s.total[i] * mult,
      edible: s.edible[i] * mult,
      nut: s.nutrition[i].map((v) => v * mult),
    };
  }
  const addNut = (a, b) => a.map((v, i) => v + b[i]);

  // ------------------------------------------------------------------ ícones
  const I = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
    plate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M3 4v5a2 2 0 0 0 2 2M3 4v16M21 4c-1.5 0-2 2-2 5s1 3 2 3v8"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    duplicate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M14.5 11.5v6M11.5 14.5h6M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };

  // ------------------------------------------------------------------ pesquisa tolerante
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  const STOP = new Set(["de", "da", "do", "das", "dos", "com", "c", "s", "e", "a", "o", "em", "ao", "na", "no"]);

  /** Formas aceites para um código: "mqa012", "mqa12", "012", "12". */
  function codeForms(code) {
    const c = code.toLowerCase();
    const digits = c.replace(/^\D+/, "");
    return [c, c.replace(/^([a-z]+)0+/, "$1"), digits, digits.replace(/^0+/, "")];
  }

  const index = [
    ...DATA.series.map((s) => ({
      kind: "serie", item: s, codes: codeForms(s.code), words: norm(s.name).split(" "),
    })),
    ...DATA.measures.map((m) => ({
      kind: "measure", item: m, codes: codeForms(m.code),
      words: norm(`${m.name} ${m.items.map((i) => i.name).join(" ")} medida caseira`).split(" "),
    })),
  ];

  /** Distância de Damerau-Levenshtein (troca de letras vizinhas conta 1), com saída antecipada. */
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  function tokenScore(q, tokens, fuzzy) {
    let best = 0;
    const max = q.length >= 7 ? 2 : 1;
    for (const t of tokens) {
      if (t === q) return 5;
      if (t.startsWith(q)) best = Math.max(best, 4);
      else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 3);
      else if (fuzzy && q.length >= 4 && best < 2) {
        // compara com a palavra inteira e com o prefixo do mesmo tamanho (pesquisa ainda a meio)
        if (lev(q, t, max) <= max || lev(q, t.slice(0, q.length), max) <= max) best = 2;
      }
    }
    return best;
  }

  function search(query) {
    let qs = norm(query).split(" ").filter(Boolean);
    const meaningful = qs.filter((t) => !STOP.has(t));
    if (meaningful.length) qs = meaningful;
    if (!qs.length) return [];
    // pesquisa por código: só correspondência exata (sem tolerância a erros)
    if (qs.length === 1 && /\d/.test(qs[0])) {
      const hits = index.filter((e) => e.codes.includes(qs[0]));
      if (hits.length) return hits;
    }
    const run = (fuzzy) => {
      const out = [];
      index.forEach((entry, order) => {
        let score = 0;
        for (const q of qs) {
          const s = tokenScore(q, entry.words, fuzzy);
          if (!s) return;
          score += s;
        }
        if (entry.words[0].startsWith(qs[0])) score += 1; // o nome começa pelo termo pesquisado
        out.push({ ...entry, score, order });
      });
      return out.sort((a, b) => b.score - a.score || a.order - b.order);
    };
    // a tolerância a erros de escrita só entra quando não há correspondência direta
    const strict = run(false);
    return strict.length ? strict : run(true);
  }

  // ------------------------------------------------------------------ componentes
  const infoBanner = (dismissible) => `
    <aside class="info" aria-label="Sobre este site">
      ${I.info}
      <p><strong>Feito para os estudantes da FCNAUP</strong>
      O intuito deste site é ajudar os estudantes da FCNAUP a utilizar o Manual Fotográfico de Quantificação de Alimentos (IAN-AF).
      Os estudantes referem que utilizar o PDF não é prático — este site foi criado com o objetivo de facilitar essa utilização.</p>
      ${dismissible ? '<button class="info__close" type="button" data-action="dismiss-info" aria-label="Fechar aviso">×</button>' : ""}
    </aside>`;

  function row(s) {
    const ts = s.total, ks = s.nutrition.map((n) => n[N.kcal]);
    const target = activeMeal();
    const addLabel = `Adicionar ${s.name} (foto ${defaultLetter(s)}) a ${target ? mealName(target) : "uma nova refeição"}`;
    return `
      <li class="row">
        <img class="row__img" src="${s.thumb}" alt="" loading="lazy" width="360" height="270">
        <div class="row__body">
          <div class="row__name"><a href="/serie/${s.code}">${esc(s.name)}</a></div>
          <div class="row__meta">${favs.has(s.code) ? '<span class="star" aria-label="Favorito">★</span> ' : ""}${s.code} · ${s.total.length} fotos</div>
          <div class="row__meta">${nf0.format(Math.min(...ts))}–${nf0.format(Math.max(...ts))} g · ${nf0.format(Math.min(...ks))}–${nf0.format(Math.max(...ks))} kcal</div>
        </div>
        <button class="row__add" type="button" data-add="${s.code}" aria-label="${esc(addLabel)}" title="${esc(addLabel)}">${I.plus}</button>
      </li>`;
  }
  const list = (items) => `<ul class="list">${items.map(row).join("")}</ul>`;

  const measureCard = (m) => `
    <a class="mcard" href="/medidas/${m.code}">
      <img src="${m.photo}" alt="" loading="lazy">
      <div><b>${m.code} – ${esc(m.name)}</b><span>${m.items.map((i) => `${i.letter}: ${esc(i.name)}`).join(" · ")}</span></div>
    </a>`;

  /** Percentagem da energia vinda de proteína, hidratos e gordura (fatores 4/4/9). */
  function energySplit(nut) {
    const e = { prot: nut[N.prot] * 4, hc: nut[N.hc] * 4, gord: nut[N.gord] * 9 };
    const sum = e.prot + e.hc + e.gord || 1;
    return { prot: Math.round((e.prot / sum) * 100), hc: Math.round((e.hc / sum) * 100), gord: Math.round((e.gord / sum) * 100) };
  }
  const macroBar = (nut, small = false) => {
    const pct = energySplit(nut);
    return `<div class="macrobar${small ? " macrobar--sm" : ""}" role="img" aria-label="Distribuição da energia: proteína ${pct.prot}%, hidratos de carbono ${pct.hc}%, gordura ${pct.gord}%">
      <i style="width:${pct.prot}%;background:var(--prot)"></i><i style="width:${pct.hc}%;background:var(--hc)"></i><i style="width:${pct.gord}%;background:var(--gord)"></i></div>`;
  };

  /** Energia em destaque + barra de distribuição energética + macros (padrão BitePal/Alma). */
  function summary(nut, sideText = "", flat = false) {
    const pct = energySplit(nut);
    const macro = (k, label, color) => `
      <div class="macro" style="--c:var(${color})"><small>${label}</small>
        <strong>${nf1.format(nut[N[k]])}<span>g</span></strong><em>${pct[k]}% da energia</em></div>`;
    return `
      <div class="summary${flat ? " summary--flat" : ""}">
        <div class="summary__kcal"><strong>${nf0.format(nut[N.kcal])}<small>kcal</small></strong><span>${sideText}</span></div>
        ${macroBar(nut)}
        <div class="macros">${macro("prot", "Proteína", "--prot")}${macro("hc", "Hidratos", "--hc")}${macro("gord", "Gordura", "--gord")}</div>
      </div>`;
  }

  function nutTable(nut, caption) {
    const g = (k) => `${nf1.format(nut[N[k]])} g`;
    return `
      <table class="nut">
        ${caption ? `<caption class="label">${caption}</caption>` : ""}
        <tr><td>Energia</td><td>${nf0.format(nut[N.kcal])} kcal</td></tr>
        <tr><td>Proteína</td><td>${g("prot")}</td></tr>
        <tr><td>Hidratos de carbono</td><td>${g("hc")}</td></tr>
        <tr class="sub"><td>dos quais açúcares</td><td>${g("acu")}</td></tr>
        <tr><td>Gordura</td><td>${g("gord")}</td></tr>
        <tr class="sub"><td>da qual ácidos gordos saturados</td><td>${g("ags")}</td></tr>
        <tr><td>Fibra</td><td>${g("fibra")}</td></tr>
      </table>`;
  }

  // ------------------------------------------------------------------ toast (padrão Garmin/Material snackbar)
  let toastTimer;
  let toastUndo = null;
  function toast(message, { link, undo } = {}) {
    clearTimeout(toastTimer);
    toastUndo = undo || null;
    // não mostra "Ver" se já estamos na página de destino
    const showLink = link && link.href !== location.pathname;
    $toast.innerHTML = `<p>${message}</p>${undo ? '<button type="button" data-toast="undo">Anular</button>' : ""}${showLink ? `<a href="${link.href}">${esc(link.label)}</a>` : ""}`;
    $toast.hidden = false;
    toastTimer = setTimeout(() => { $toast.hidden = true; }, 5000);
  }
  $toast.addEventListener("click", (e) => {
    if (e.target.closest("[data-toast=undo]") && toastUndo) { toastUndo(); toastUndo = null; }
    if (e.target.closest("a, button")) $toast.hidden = true;
  });

  // ------------------------------------------------------------------ refeições (ações)
  /** Adiciona à refeição indicada, ou à ativa; se não houver nenhuma, cria uma com nome pela hora. */
  function addToMeal(code, letter, mult, gramsValue = null, mealId = activeId) {
    const s = byCode.get(code);
    const meal = mealById(mealId) ?? createMeal();
    activeId = meal.id;
    const item = { id: uid(), code, letter, mult, grams: gramsValue };
    meal.items.push(item);
    saveMeals();
    const p = portion(s, letter, mult);
    toast(`<b>${esc(s.name)}</b> adicionado a <b>${esc(mealName(meal))}</b> · ${gramsValue ? `${grams(gramsValue)} g` : `${fracLabel(mult)} × foto ${letter}`} · ${nf0.format(p.nut[N.kcal])} kcal`, {
      link: { href: `/refeicao/${meal.id}`, label: "Ver" },
      undo: () => { meal.items = meal.items.filter((x) => x.id !== item.id); saveMeals(); render({ keepScroll: true }); },
    });
  }

  function mealTotals(mealList) {
    let nut = [0, 0, 0, 0, 0, 0, 0], total = 0, edible = 0, count = 0;
    for (const meal of mealList) {
      for (const it of meal.items) {
        const p = portion(byCode.get(it.code), it.letter, it.mult);
        nut = addNut(nut, p.nut); total += p.total; edible += p.edible; count++;
      }
    }
    return { nut, total, edible, count };
  }

  function totalLines(t) {
    const g = (k) => `${nf1.format(t.nut[N[k]])} g`;
    return [
      `${nf0.format(t.nut[N.kcal])} kcal · ${grams(t.total)} g (edível ${grams(t.edible)} g)`,
      `Proteína ${g("prot")} · Hidratos de carbono ${g("hc")} (açúcares ${g("acu")}) · Gordura ${g("gord")} (AG saturados ${g("ags")}) · Fibra ${g("fibra")}`,
    ];
  }

  function mealBlock(meal) {
    const lines = [mealName(meal)];
    for (const it of meal.items) {
      const s = byCode.get(it.code);
      const p = portion(s, it.letter, it.mult);
      const q = it.grams ? `${grams(it.grams)} g` : `${fracLabel(it.mult)} × foto ${it.letter}`;
      lines.push(`• ${s.name} (${s.code}) — ${q}: ${grams(p.total)} g (edível ${grams(p.edible)} g), ${nf0.format(p.nut[N.kcal])} kcal`);
    }
    const [a, b] = totalLines(mealTotals([meal]));
    lines.push(`Total: ${a}`, b);
    return lines.join("\n");
  }

  function mealText(meal) {
    return `${mealBlock(meal)}\n\n— Manual Fotográfico IAN-AF`;
  }

  function allMealsText() {
    const blocks = meals.filter((m) => m.items.length).map(mealBlock);
    const [a, b] = totalLines(mealTotals(meals));
    return `${blocks.join("\n\n")}\n\nTOTAL DE TODAS AS REFEIÇÕES: ${a}\n${b}\n\n— Manual Fotográfico IAN-AF`;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.append(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove();
      return ok;
    }
  }

  // ------------------------------------------------------------------ vistas
  let category = null;
  const detailState = { code: null, letter: "C", mult: 1, mode: "foto", grams: 100 };
  const measureState = { code: null, letter: "A", frac: 3, mult: 1 };

  function viewFoods() {
    const q = $q.value.trim();
    if (q) return viewSearch(q);

    const items = category === null ? DATA.series : DATA.series.filter((s) => s.category === category);
    const chips = [`<button class="chip" data-cat="" aria-pressed="${category === null}">Todos<span class="n">${DATA.series.length}</span></button>`]
      .concat(DATA.categories.map((c) => {
        const n = DATA.series.filter((s) => s.category === c).length;
        return `<button class="chip" data-cat="${esc(c)}" aria-pressed="${category === c}">${esc(c)}<span class="n">${n}</span></button>`;
      })).join("");

    const rec = recent.map((c) => byCode.get(c)).filter(Boolean).slice(0, 10);
    return `
      ${infoDismissed ? "" : infoBanner(true)}
      ${rec.length ? `
        <div class="section-title"><h2>Vistos recentemente</h2></div>
        <div class="recent">${rec.map((s) => `<a href="/serie/${s.code}"><img src="${s.thumb}" alt="" loading="lazy" width="360" height="270"><span>${esc(s.name)}</span></a>`).join("")}</div>` : ""}
      <div class="section-title"><h2>Alimentos e receitas</h2><span>${items.length} séries</span></div>
      <div class="chips" role="toolbar" aria-label="Filtrar por categoria">${chips}</div>
      ${activeTargetHint()}
      ${list(items)}`;
  }

  /** Indica para onde vai o "+" da lista (padrão Yazio: refeição selecionada no topo). */
  function activeTargetHint() {
    const m = activeMeal();
    return `<p class="target">${I.plate}<span>O <b>+</b> adiciona a ${m ? `<a href="/refeicao/${m.id}">${esc(mealName(m))}</a>` : "uma nova refeição"}</span>${meals.length > 1 ? `
      <select data-action="target-meal" aria-label="Refeição de destino">${meals.map((x) => `<option value="${x.id}"${x.id === activeId ? " selected" : ""}>${esc(mealName(x))}</option>`).join("")}</select>` : ""}</p>`;
  }

  function viewSearch(q) {
    const res = search(q);
    const series = res.filter((r) => r.kind === "serie").map((r) => r.item);
    const measures = res.filter((r) => r.kind === "measure").map((r) => r.item);
    if (!res.length) {
      return `<div class="empty"><div class="empty__icon">${I.search}</div><strong>Nada encontrado para “${esc(q)}”</strong>Tente outra palavra (ex.: “arroz”, “bacalhau”, “copo”) ou o código da série (ex.: MQA077 ou 77).</div>`;
    }
    return `
      <p class="meta">${series.length} ${series.length === 1 ? "resultado" : "resultados"}${measures.length ? ` e ${measures.length} ${measures.length === 1 ? "medida caseira" : "medidas caseiras"}` : ""} para “${esc(q)}”</p>
      ${series.length ? activeTargetHint() + list(series) : ""}
      ${measures.length ? `<div class="section-title"><h2>Medidas caseiras</h2></div><div class="mlist">${measures.map(measureCard).join("")}</div>` : ""}`;
  }

  function viewFavs() {
    const items = [...favs].map((c) => byCode.get(c)).filter(Boolean);
    if (!items.length) {
      return `<div class="empty"><div class="empty__icon">${I.star}</div><strong>Ainda sem favoritos</strong>Abra um alimento e toque na estrela para o guardar aqui. Os favoritos ficam guardados apenas neste navegador.<br><a class="btn btn--primary" href="/">${I.search} Pesquisar alimentos</a></div>`;
    }
    return `<div class="section-title"><h2>Favoritos</h2><span>${items.length}</span></div>${activeTargetHint()}${list(items)}`;
  }

  function viewSerie(code) {
    const s = byCode.get(code);
    if (!s) return viewNotFound();
    const letters = rowLetters(s);
    if (detailState.code !== code) {
      const L = defaultLetter(s);
      Object.assign(detailState, { code, letter: L, mult: 1, mode: "foto", grams: s.total[letters.indexOf(L)] });
      pushRecent(code);
    }
    const st = detailState;
    // no modo gramas, a foto mostrada é a de peso mais próximo e o multiplicador é derivado
    if (st.mode === "g") {
      st.letter = closestLetter(s, st.grams);
      st.mult = st.grams / s.total[letters.indexOf(st.letter)];
    }
    const i = letters.indexOf(st.letter);
    const photo = photoOf(s, st.letter);
    const p = portion(s, st.letter, st.mult);
    const isFav = favs.has(code);
    const qtyText = st.mode === "g" ? `${grams(st.grams)} g` : `${fracLabel(st.mult)} × foto ${st.letter}`;
    const target = activeMeal();

    return `
      <button class="back" type="button" data-action="back">${I.back} Voltar</button>
      <div class="head">
        <div>
          <h1>${esc(s.name)}</h1>
          <div class="sub"><span class="tag">${s.code}</span>${esc(s.category)}</div>
        </div>
        <button class="icon-btn" type="button" data-action="fav" aria-pressed="${isFav}" aria-label="${isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}" title="Favorito">${I.star}</button>
      </div>
      ${NOTES[code] ? `<p class="note">⚠︎ <span>${NOTES[code]}</span></p>` : ""}
      <div class="detail">
        <div class="detail__media">
          <div class="photo">
            ${photo
              ? `<img src="${photo}" alt="${esc(s.name)}, porção ${st.letter}" data-action="zoom" width="800" height="600">
                 <button class="photo__zoom" type="button" data-action="zoom" aria-label="Ampliar fotografia">${I.zoom}</button>`
              : `<div class="photo__missing">A porção ${st.letter} não tem fotografia no manual.</div>`}
            <span class="photo__badge"><b>${st.letter}</b> · ${grams(s.total[i])} g</span>
          </div>
          <div class="strip" style="--n:${letters.length}" role="group" aria-label="Escolher fotografia">
            ${letters.map((L, j) => {
              const ph = photoOf(s, L);
              return `<button type="button" data-letter="${L}" aria-pressed="${L === st.letter}" aria-label="Foto ${L}, ${s.total[j]} gramas">
                ${ph ? `<img src="${ph}" alt="" loading="lazy">` : '<div class="ph"></div>'}
                <b>${L}</b><span>${grams(s.total[j])} g</span></button>`;
            }).join("")}
          </div>
        </div>

        <div>
          <section class="panel" aria-labelledby="calc-t">
            <h2 id="calc-t">Porção consumida</h2>
            <div class="segmented" role="group" aria-label="Modo de quantificação">
              <button type="button" data-mode="foto" aria-pressed="${st.mode === "foto"}">Por fotografia</button>
              <button type="button" data-mode="g" aria-pressed="${st.mode === "g"}">Em gramas</button>
            </div>
            ${st.mode === "foto" ? `
              <div class="label">Fotografia</div>
              <div class="pills" role="group" aria-label="Fotografia">
                ${letters.map((L) => `<button type="button" data-letter="${L}" aria-pressed="${L === st.letter}">${L}</button>`).join("")}
              </div>
              <div class="label">Quantidade da fotografia</div>
              <div class="pills" role="group" aria-label="Fração da fotografia">
                ${FRACTIONS.map((f) => `<button type="button" data-mult="${f.v}" aria-pressed="${f.v === st.mult}">${f.t}</button>`).join("")}
              </div>
              <div class="stepper-row">
                <div class="stepper">
                  <button type="button" data-step="-0.25" aria-label="Menos um quarto">−</button>
                  <input type="text" inputmode="decimal" value="${String(+st.mult.toFixed(3)).replace(".", ",")}" data-action="mult" aria-label="Multiplicador da fotografia">
                  <button type="button" data-step="0.25" aria-label="Mais um quarto">+</button>
                </div>
                <span>× foto ${st.letter}</span>
              </div>` : `
              <div class="label">Peso total consumido</div>
              <div class="stepper-row" style="margin-top:0">
                <div class="stepper">
                  <button type="button" data-gstep="-10" aria-label="Menos 10 gramas">−</button>
                  <input type="text" inputmode="decimal" value="${String(+st.grams.toFixed(1)).replace(".", ",")}" data-action="grams" aria-label="Gramas">
                  <button type="button" data-gstep="10" aria-label="Mais 10 gramas">+</button>
                </div>
                <span>g · foto mais próxima: <b>${st.letter}</b> (${grams(s.total[i])} g)</span>
              </div>`}

            ${summary(p.nut, qtyText)}
            <div class="weights">
              <div><small>Peso total</small><strong>${grams(p.total)} g</strong></div>
              <div><small>Peso edível</small><strong>${grams(p.edible)} g</strong></div>
            </div>
            ${nutTable(p.nut, "Informação nutricional")}

            <div class="addbar">
              <select class="addbar__meal" data-action="target-meal" aria-label="Refeição de destino">
                ${meals.map((m) => `<option value="${m.id}"${m.id === activeId ? " selected" : ""}>${esc(mealName(m))}</option>`).join("")}
                ${target ? "" : `<option value="" selected>${esc(defaultMealName())} (nova)</option>`}
                <option value="__new">＋ Nova refeição</option>
              </select>
              <button class="btn btn--primary" type="button" data-action="add">${I.plus} Adicionar <span>· ${qtyText}</span></button>
            </div>
          </section>

          <section class="panel" aria-labelledby="tab-t">
            <h2 id="tab-t">Todas as porções</h2>
            <div class="table-wrap">
              <table class="full">
                <thead><tr>
                  <th>Foto</th><th>Peso total (g)</th><th>Peso edível (g)</th>
                  ${DATA.nutrients.map((n) => `<th>${n.label} (${n.unit})</th>`).join("")}
                </tr></thead>
                <tbody>
                  ${letters.map((L, j) => `<tr data-letter="${L}" aria-selected="${L === st.letter}">
                    <td><b>${L}</b></td><td>${s.total[j]}</td><td>${s.edible[j]}</td>
                    ${s.nutrition[j].map((v, k) => `<td>${k === 0 ? nf0.format(v) : nf1.format(v)}</td>`).join("")}
                  </tr>`).join("")}
                </tbody>
              </table>
            </div>
            <p class="hint">Toque numa linha para ver a fotografia. Valores tal como no manual (Tabelas 1, 2 e 3).</p>
          </section>
        </div>
      </div>`;
  }

  const presetChips = () => `
    <div class="presets" role="group" aria-label="Criar refeição">
      ${MEAL_PRESETS.map((p) => `<button class="chip" type="button" data-new-meal="${p}">${I.plus}${p}</button>`).join("")}
      <button class="chip" type="button" data-new-meal="">${I.plus}Outra</button>
    </div>`;

  /** Lista de refeições (padrão Yazio/Lifesum: cartões por refeição + total do dia). */
  function viewMeals() {
    if (!meals.length) {
      return `
        <div class="section-title"><h2>Refeições</h2></div>
        <div class="empty">
          <div class="empty__icon">${I.plate}</div>
          <strong>Crie a sua primeira refeição</strong>
          Monte várias refeições (ex.: pequeno-almoço, almoço e jantar) com as porções do manual e veja os totais de energia e nutrientes de cada uma e de todas juntas.
        </div>
        ${presetChips()}`;
    }
    const all = mealTotals(meals);
    return `
      <div class="section-title"><h2>Refeições</h2><span>${meals.length} ${meals.length === 1 ? "refeição" : "refeições"}</span></div>
      <div class="meals">
        <div class="meals__list">
          <ul class="mealcards">
            ${meals.map((m) => {
              const t = mealTotals([m]);
              const photos = m.items.slice(0, 4).map((it) => photoOf(byCode.get(it.code), it.letter)).filter(Boolean);
              return `<li><a class="mealcard" href="/refeicao/${m.id}">
                <div class="mealcard__thumbs">${photos.length ? photos.map((src) => `<img src="${src}" alt="" loading="lazy">`).join("") : `<span>${I.plate}</span>`}</div>
                <div class="mealcard__body">
                  <b>${esc(mealName(m))}${m.id === activeId ? ' <span class="pill-active">ativa</span>' : ""}</b>
                  <small>${m.items.length ? `${m.items.length} ${m.items.length === 1 ? "alimento" : "alimentos"} · ${grams(t.total)} g` : "Vazia"}</small>
                  ${m.items.length ? macroBar(t.nut, true) : ""}
                </div>
                <div class="mealcard__kcal">${nf0.format(t.nut[N.kcal])}<small>kcal</small></div>
                <span class="mealcard__go">${I.chevron}</span>
              </a></li>`;
            }).join("")}
          </ul>
          <div class="label" style="margin-top:20px">Nova refeição</div>
          ${presetChips()}
        </div>

        <aside class="meals__side">
          <section class="panel">
            <h2>${meals.length > 1 ? "Total de todas as refeições" : "Total"}</h2>
            ${summary(all.nut, `${all.count} ${all.count === 1 ? "alimento" : "alimentos"}`, true)}
            <div class="weights">
              <div><small>Peso total</small><strong>${grams(all.total)} g</strong></div>
              <div><small>Peso edível</small><strong>${grams(all.edible)} g</strong></div>
            </div>
            ${nutTable(all.nut)}
            <div class="actions actions--single">
              <button class="btn" type="button" data-action="copy-all"${all.count ? "" : " disabled"}>${I.copy} Copiar resumo de todas</button>
            </div>
          </section>
        </aside>
      </div>`;
  }

  function viewMeal(id) {
    const meal = mealById(id);
    if (!meal) return viewNotFound();
    if (activeId !== id) { activeId = id; saveMeals(); }
    const nameInput = `<input class="meal__name" type="text" value="${esc(meal.name)}" placeholder="Nome da refeição" data-action="meal-name" aria-label="Nome da refeição" maxlength="60">`;
    const back = `<button class="back" type="button" data-action="to-meals">${I.back} Refeições</button>`;
    const others = meals.filter((m) => m.id !== id);

    if (!meal.items.length) {
      return `
        ${back}
        ${nameInput}
        <div class="empty">
          <div class="empty__icon">${I.plate}</div>
          <strong>Refeição vazia</strong>
          Pesquise alimentos e toque em <b>+</b> na lista, ou abra um alimento, escolha a porção e toque em <b>Adicionar</b>. Os alimentos vão para esta refeição.
          <br><button class="btn btn--primary" type="button" data-action="find">${I.search} Pesquisar alimentos</button>
          <br><button class="btn btn--danger" type="button" data-action="delete-meal" style="margin-top:8px">${I.trash} Apagar refeição</button>
        </div>`;
    }

    const t = mealTotals([meal]);
    const qtyOptions = (it) => {
      const opts = FRACTIONS.map((f) => `<option value="${f.v}"${!it.grams && f.v === it.mult ? " selected" : ""}>${f.t} × foto</option>`);
      if (it.grams) opts.unshift(`<option value="g" selected>${grams(it.grams)} g</option>`);
      else if (!FRACTIONS.some((f) => f.v === it.mult)) opts.unshift(`<option value="${it.mult}" selected>${fracLabel(it.mult)} × foto</option>`);
      return opts.join("");
    };

    return `
      ${back}
      <div class="meal">
        <div>
          ${nameInput}
          <p class="meal__hint">Os alimentos que adicionar (+) vão para esta refeição. Tudo fica guardado neste navegador.</p>
          <ul class="items">
            ${meal.items.map((it) => {
              const s = byCode.get(it.code);
              const p = portion(s, it.letter, it.mult);
              const ph = photoOf(s, it.letter);
              return `<li class="item" data-item="${it.id}">
                ${ph ? `<img src="${ph}" alt="" loading="lazy">` : '<div class="ph"></div>'}
                <div>
                  <div class="item__name"><a href="/serie/${s.code}">${esc(s.name)}</a></div>
                  <div class="item__meta">${grams(p.total)} g · edível ${grams(p.edible)} g</div>
                  <div class="item__controls">
                    <select data-item-letter aria-label="Fotografia">${rowLetters(s).map((L) => `<option value="${L}"${L === it.letter ? " selected" : ""}>Foto ${L}</option>`).join("")}</select>
                    <select data-item-qty aria-label="Quantidade">${qtyOptions(it)}</select>
                    ${others.length ? `<select data-item-move aria-label="Mover para outra refeição"><option value="" selected>Mover…</option>${others.map((m) => `<option value="${m.id}">→ ${esc(mealName(m))}</option>`).join("")}</select>` : ""}
                  </div>
                </div>
                <div class="item__side">
                  <div class="item__kcal">${nf0.format(p.nut[N.kcal])}<small>kcal</small></div>
                  <button class="item__remove" type="button" data-remove="${it.id}" aria-label="Remover ${esc(s.name)}">${I.x}</button>
                </div>
              </li>`;
            }).join("")}
          </ul>
          <button class="add-more" type="button" data-action="find">${I.plus} Adicionar alimento</button>
        </div>

        <div class="meal__side">
          <section class="panel">
            <h2>Total da refeição</h2>
            ${summary(t.nut, `${meal.items.length} ${meal.items.length === 1 ? "alimento" : "alimentos"}`, true)}
            <div class="weights">
              <div><small>Peso total</small><strong>${grams(t.total)} g</strong></div>
              <div><small>Peso edível</small><strong>${grams(t.edible)} g</strong></div>
            </div>
            ${nutTable(t.nut)}
            <div class="actions">
              <button class="btn" type="button" data-action="copy-meal">${I.copy} Copiar resumo</button>
              <button class="btn" type="button" data-action="duplicate-meal">${I.duplicate} Duplicar</button>
              <button class="btn btn--danger" type="button" data-action="delete-meal">${I.trash} Apagar refeição</button>
            </div>
          </section>
        </div>
      </div>`;
  }

  function viewMeasures() {
    return `
      <div class="section-title"><h2>Medidas caseiras</h2><span>${DATA.measures.length} séries</span></div>
      <p class="meta" style="margin-top:0">Volumes (mL) correspondentes às marcas ¼, ½, ¾ e 1 de cada recipiente (Tabela 4 do manual).</p>
      <div class="mlist">${DATA.measures.map(measureCard).join("")}</div>`;
  }

  function viewMeasure(code) {
    const m = measureByCode.get(code);
    if (!m) return viewNotFound();
    if (measureState.code !== code) Object.assign(measureState, { code, letter: m.items[0].letter, frac: 3, mult: 1 });
    const it = m.items.find((x) => x.letter === measureState.letter) ?? m.items[0];
    const ml = it.ml[measureState.frac] * measureState.mult;
    return `
      <button class="back" type="button" data-action="back">${I.back} Voltar</button>
      <div class="head"><div><h1>${esc(m.name)}</h1><div class="sub"><span class="tag">${m.code}</span>Medida caseira</div></div></div>
      <div class="detail">
        <div class="detail__media"><div class="mphoto"><img src="${m.photo}" alt="${esc(m.name)}" data-action="zoom"></div></div>
        <div>
          <section class="panel">
            <h2>Calculadora de volume</h2>
            <div class="label">Recipiente</div>
            <div class="pills" role="group" aria-label="Recipiente">
              ${m.items.map((x) => `<button type="button" data-mletter="${x.letter}" aria-pressed="${x.letter === it.letter}">${x.letter}</button>`).join("")}
            </div>
            <div class="label">Marca</div>
            <div class="pills" role="group" aria-label="Marca">
              ${MEASURE_FRACTIONS.map((t, k) => `<button type="button" data-frac="${k}" aria-pressed="${k === measureState.frac}">${t}</button>`).join("")}
            </div>
            <div class="stepper-row">
              <div class="stepper">
                <button type="button" data-mstep="-1" aria-label="Menos um recipiente">−</button>
                <input type="text" inputmode="decimal" value="${String(measureState.mult).replace(".", ",")}" data-action="mmult" aria-label="Número de recipientes">
                <button type="button" data-mstep="1" aria-label="Mais um recipiente">+</button>
              </div>
              <span>recipiente(s)</span>
            </div>
            <div class="bigval"><small>${esc(it.letter)} · ${esc(it.name)} · até à marca ${MEASURE_FRACTIONS[measureState.frac]}${measureState.mult !== 1 ? ` × ${fracLabel(measureState.mult)}` : ""}</small><strong>${nf0.format(ml)}<span>mL</span></strong></div>
          </section>
          <section class="panel">
            <h2>Volumes (mL)</h2>
            <div class="table-wrap">
              <table class="full" style="min-width:420px">
                <thead><tr><th></th><th style="text-align:left">Recipiente</th>${MEASURE_FRACTIONS.map((t) => `<th>${t}</th>`).join("")}</tr></thead>
                <tbody>${m.items.map((x) => `<tr data-mletter="${x.letter}" aria-selected="${x.letter === it.letter}"><td><b>${x.letter}</b></td><td style="text-align:left">${esc(x.name)}</td>${x.ml.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>`;
  }

  function viewAbout() {
    return `
      <article class="prose">
        <h1>Sobre este site</h1>
        ${infoBanner(false)}
        <p>Versão pesquisável do <b>Manual Fotográfico de Quantificação de Alimentos</b> do Inquérito Alimentar Nacional e de Atividade Física (IAN-AF 2015-2016), pensada para ser consultada rapidamente no telemóvel ou no computador.</p>
        <p>Inclui as ${DATA.series.length} séries fotográficas de alimentos e receitas, com o <b>peso total</b> e o <b>peso edível</b> de cada fotografia, a respetiva <b>composição nutricional</b> e as ${DATA.measures.length} séries de <b>medidas caseiras</b>.</p>
        <h2>Como usar</h2>
        <ul>
          <li><b>Pesquisar:</b> escreva o nome do alimento — a pesquisa ignora acentos e tolera pequenos erros (ex.: “brocolos”, “bacalao”) — ou o código (ex.: “MQA077” ou “77”). No computador, carregue em <kbd>/</kbd> para ir à pesquisa.</li>
          <li><b>Fotografias:</b> em cada série estão por ordem crescente de quantidade (A, B, C…). A foto C corresponde, tipicamente, à porção média.</li>
          <li><b>Porção consumida:</b> tal como no inquérito, escolha uma fotografia e uma fração (¼, ½, ¾) ou múltiplo; ou indique diretamente os gramas.</li>
          <li><b>Refeições:</b> crie várias refeições (pequeno-almoço, almoço, jantar…) e adicione alimentos com o <b>+</b> da lista ou com o botão <b>Adicionar</b>, escolhendo a refeição de destino. Veja os totais de cada refeição e de todas juntas, mova alimentos entre refeições, duplique refeições e copie um resumo em texto.</li>
          <li><b>Favoritos</b>, refeições e vistos recentemente ficam guardados apenas neste navegador.</li>
        </ul>
        <h2>Fonte</h2>
        <p>Torres D, Faria N, Sousa N, Teixeira S, Soares R, Amorim H, Guiomar S, Lobato L, Oliveira C, Correia D, Carvalho C, Vilela S, Severo M, Lopes C. <i>Inquérito Alimentar Nacional e de Atividade Física, IAN-AF 2015-2016: Manual Fotográfico de Quantificação de Alimentos.</i> Universidade do Porto, 2017. ISBN: 978-989-746-182-8. Disponível em <a href="https://ian-af.up.pt" target="_blank" rel="noopener">www.ian-af.up.pt</a>.</p>
        <p>As imagens e os dados pertencem aos autores do manual. Os valores são reproduzidos tal como no original; quando parecem existir gralhas, é apresentada uma nota na respetiva série. A distribuição da energia (proteína, hidratos, gordura) é calculada com os fatores 4, 4 e 9 kcal/g.</p>
        <h2>Autor do site</h2>
        <p>Criado por <a href="https://miguelrocha.dev" target="_blank" rel="noopener">Miguel Rocha</a> — <a href="https://miguelrocha.dev" target="_blank" rel="noopener">miguelrocha.dev</a>.</p>
      </article>`;
  }

  const viewNotFound = () => `<div class="empty"><strong>Página não encontrada</strong><a class="btn" href="/">Voltar à lista de alimentos</a></div>`;

  // ------------------------------------------------------------------ router
  let current = { name: "foods", tab: "foods", arg: null };
  let navigatedInside = false;
  const scrollPositions = {};

  // URLs limpas (/serie/MQA001) com a History API; o servidor devolve index.html em qualquer rota.
  history.scrollRestoration = "manual";
  // links antigos no formato /#/serie/MQA001 continuam a funcionar
  if (location.hash.startsWith("#/")) history.replaceState(null, "", location.hash.slice(1));

  function navigate(path) {
    if (path === location.pathname) return;
    history.pushState(null, "", path);
    navigatedInside = true;
    onRoute();
  }

  function parseRoute() {
    const [, name = "", arg = ""] = location.pathname.split("/");
    switch (name) {
      case "serie": return { name: "serie", tab: "foods", arg: decodeURIComponent(arg).toUpperCase() };
      case "refeicao": return arg ? { name: "meal", tab: "meal", arg: decodeURIComponent(arg) } : { name: "meals", tab: "meal" };
      case "favoritos": return { name: "favs", tab: "favs" };
      case "medidas": return arg ? { name: "measure", tab: "measures", arg: decodeURIComponent(arg).toUpperCase() } : { name: "measures", tab: "measures" };
      case "sobre": return { name: "about", tab: "about" };
      default: return { name: "foods", tab: "foods" };
    }
  }

  function render({ keepScroll = false } = {}) {
    const y = window.scrollY;
    $main.innerHTML = {
      foods: viewFoods,
      favs: viewFavs,
      serie: () => viewSerie(current.arg),
      meals: viewMeals,
      meal: () => viewMeal(current.arg),
      measures: viewMeasures,
      measure: () => viewMeasure(current.arg),
      about: viewAbout,
    }[current.name]();
    document.body.classList.toggle("has-addbar", current.name === "serie" && byCode.has(current.arg));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.tab === current.tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const s = current.name === "serie" && byCode.get(current.arg);
    const m = current.name === "measure" && measureByCode.get(current.arg);
    const ml = current.name === "meal" && mealById(current.arg);
    document.title = s ? `${s.name} · Manual Fotográfico IAN-AF`
      : m ? `${m.name} · Manual Fotográfico IAN-AF`
      : ml ? `${mealName(ml)} · Manual Fotográfico IAN-AF`
      : current.name === "meals" ? "Refeições · Manual Fotográfico IAN-AF"
      : "Manual Fotográfico IAN-AF";
    if (keepScroll) window.scrollTo(0, y);
  }

  function onRoute() {
    scrollPositions[`${current.name}/${current.arg ?? ""}`] = window.scrollY;
    current = parseRoute();
    render();
    $toast.querySelector(`a[href="${CSS.escape(location.pathname)}"]`)?.remove(); // já estamos na página do link
    // volta à posição anterior das listas (útil no telemóvel ao regressar de um alimento)
    const saved = scrollPositions[`${current.name}/${current.arg ?? ""}`];
    window.scrollTo(0, ["foods", "favs", "measures", "meals"].includes(current.name) && saved ? saved : 0);
  }

  window.addEventListener("popstate", onRoute);
  // link antigo (/#/…) aberto com o site já carregado: converte para o caminho limpo
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#/")) return;
    history.replaceState(null, "", location.hash.slice(1));
    navigatedInside = true;
    onRoute();
  });

  // links internos navegam sem recarregar a página (exceto com Ctrl/⌘/Shift ou em nova aba)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname);
  });

  // ------------------------------------------------------------------ eventos
  let typingTimer;
  $q.addEventListener("input", () => {
    $clear.hidden = !$q.value;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (current.name !== "foods") { navigate("/"); return; }
      render();
    }, 80);
  });
  $q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = $main.querySelector(".row__name a, .mcard");
      if (first && $q.value.trim()) { $q.blur(); first.click(); }
    }
    if (e.key === "Escape") { $q.value = ""; $q.dispatchEvent(new Event("input")); }
  });
  $clear.addEventListener("click", () => { $q.value = ""; $q.dispatchEvent(new Event("input")); $q.focus(); });

  document.addEventListener("keydown", (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement.tagName);
    if (e.key === "/" && !typing && !$zoom.open) { e.preventDefault(); $q.focus(); $q.select(); }
    if (current.name === "serie" && !$zoom.open && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      stepLetter(e.key === "ArrowRight" ? 1 : -1);
    }
  });

  function selectLetter(L) {
    detailState.letter = L;
    if (detailState.mode === "g") {
      const s = byCode.get(current.arg);
      detailState.grams = s.total[rowLetters(s).indexOf(L)];
    }
  }

  function stepLetter(dir) {
    const letters = rowLetters(byCode.get(current.arg));
    const i = letters.indexOf(detailState.letter) + dir;
    if (i >= 0 && i < letters.length) { selectLetter(letters[i]); render({ keepScroll: true }); }
  }

  function flashAdded(btn) {
    btn.dataset.added = "true";
    btn.innerHTML = I.check;
    setTimeout(() => { btn.dataset.added = "false"; btn.innerHTML = I.plus; }, 1200);
  }

  $main.addEventListener("click", (e) => {
    const t = e.target.closest("button, img[data-action], tr[data-letter], tr[data-mletter]");
    if (!t) return;
    const d = t.dataset;
    const rerender = () => render({ keepScroll: true });
    const openMeal = current.name === "meal" ? mealById(current.arg) : null;

    if (d.cat !== undefined) { category = d.cat || null; render(); return; }
    if (d.add) {
      const s = byCode.get(d.add);
      const hadMeal = !!activeMeal();
      addToMeal(s.code, defaultLetter(s), 1);
      // a primeira adição cria uma refeição: atualiza a indicação de destino
      if (!hadMeal) rerender(); else flashAdded(t);
      return;
    }
    if (d.letter) { selectLetter(d.letter); rerender(); return; }
    if (d.mult) { detailState.mult = Number(d.mult); rerender(); return; }
    if (d.step) { detailState.mult = Math.max(0.25, +(detailState.mult + Number(d.step)).toFixed(3)); rerender(); return; }
    if (d.gstep) { detailState.grams = Math.max(1, Math.round(detailState.grams + Number(d.gstep))); rerender(); return; }
    if (d.mode) {
      if (d.mode === "g" && detailState.mode !== "g") {
        detailState.grams = Math.round(portion(byCode.get(current.arg), detailState.letter, detailState.mult).total);
      }
      if (d.mode === "foto" && detailState.mode !== "foto") detailState.mult = 1;
      detailState.mode = d.mode; rerender(); return;
    }
    if (d.mletter) { measureState.letter = d.mletter; rerender(); return; }
    if (d.frac) { measureState.frac = Number(d.frac); rerender(); return; }
    if (d.mstep) { measureState.mult = Math.max(1, measureState.mult + Number(d.mstep)); rerender(); return; }
    if (d.newMeal !== undefined) {
      const meal = createMeal(uniqueName(d.newMeal || `Refeição ${meals.length + 1}`));
      navigate(`/refeicao/${meal.id}`);
      return;
    }
    if (d.remove && openMeal) {
      const idx = openMeal.items.findIndex((x) => x.id === d.remove);
      const [removed] = openMeal.items.splice(idx, 1);
      saveMeals(); rerender();
      toast(`${esc(byCode.get(removed.code).name)} removido`, { undo: () => { openMeal.items.splice(idx, 0, removed); saveMeals(); rerender(); } });
      return;
    }

    switch (d.action) {
      case "back": navigatedInside ? history.back() : navigate(current.name === "measure" ? "/medidas" : "/"); break;
      case "to-meals": navigate("/refeicao"); break;
      case "fav": toggleFav(current.arg); rerender(); break;
      case "zoom": openZoom(); break;
      case "dismiss-info": infoDismissed = true; store.set("mqa:info-dismissed", true); rerender(); break;
      case "add": {
        const st = detailState;
        const hadMeal = !!activeMeal();
        addToMeal(current.arg, st.letter, st.mult, st.mode === "g" ? st.grams : null);
        if (!hadMeal) rerender(); // a refeição criada passa a aparecer no seletor
        break;
      }
      case "find":
        navigate("/");
        setTimeout(() => { $q.focus(); window.scrollTo(0, 0); }, 50);
        break;
      case "copy-meal":
        copyText(mealText(openMeal)).then((ok) => toast(ok ? "Resumo copiado — pode colar num documento ou mensagem" : "Não foi possível copiar"));
        break;
      case "copy-all":
        copyText(allMealsText()).then((ok) => toast(ok ? "Resumo de todas as refeições copiado" : "Não foi possível copiar"));
        break;
      case "duplicate-meal": {
        const copy = { id: uid(), name: uniqueName(`${mealName(openMeal)} (cópia)`), items: openMeal.items.map((it) => ({ ...it, id: uid() })) };
        meals.splice(meals.indexOf(openMeal) + 1, 0, copy);
        activeId = copy.id;
        saveMeals();
        navigate(`/refeicao/${copy.id}`);
        toast(`Refeição duplicada: <b>${esc(copy.name)}</b>`);
        break;
      }
      case "delete-meal": {
        const idx = meals.indexOf(openMeal);
        meals.splice(idx, 1);
        if (activeId === openMeal.id) activeId = meals[Math.max(0, idx - 1)]?.id ?? null;
        saveMeals();
        navigate("/refeicao");
        toast(`Refeição <b>${esc(mealName(openMeal))}</b> apagada`, {
          undo: () => { meals.splice(idx, 0, openMeal); activeId = openMeal.id; saveMeals(); render(); },
        });
        break;
      }
    }
  });

  $main.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.action === "target-meal") {
      if (el.value === "__new") {
        const meal = createMeal();
        toast(`Refeição <b>${esc(meal.name)}</b> criada — os alimentos vão para ela`, { link: { href: `/refeicao/${meal.id}`, label: "Ver" } });
      } else if (el.value) {
        activeId = el.value; saveMeals();
      }
      render({ keepScroll: true });
      return;
    }
    const itemEl = el.closest("[data-item]");
    if (itemEl) {
      const meal = mealById(current.arg);
      const it = meal.items.find((x) => x.id === itemEl.dataset.item);
      const s = byCode.get(it.code);
      if (el.matches("[data-item-letter]")) {
        it.letter = el.value;
        // itens em gramas mantêm os gramas; muda só a foto de referência
        if (it.grams) it.mult = it.grams / s.total[rowLetters(s).indexOf(it.letter)];
      } else if (el.matches("[data-item-qty]") && el.value !== "g") {
        it.mult = Number(el.value); it.grams = null;
      } else if (el.matches("[data-item-move]") && el.value) {
        const dest = mealById(el.value);
        const idx = meal.items.indexOf(it);
        meal.items.splice(idx, 1);
        dest.items.push(it);
        saveMeals(); render({ keepScroll: true });
        toast(`${esc(s.name)} movido para <b>${esc(mealName(dest))}</b>`, {
          link: { href: `/refeicao/${dest.id}`, label: "Ver" },
          undo: () => { dest.items.splice(dest.items.indexOf(it), 1); meal.items.splice(idx, 0, it); saveMeals(); render({ keepScroll: true }); },
        });
        return;
      }
      saveMeals(); render({ keepScroll: true });
      return;
    }
    if (el.dataset.action === "meal-name") return;
    const v = parseNum(el.value);
    if (v > 0) {
      if (el.dataset.action === "mult") detailState.mult = v;
      if (el.dataset.action === "grams") detailState.grams = v;
      if (el.dataset.action === "mmult") measureState.mult = v;
    }
    render({ keepScroll: true });
  });

  $main.addEventListener("input", (e) => {
    if (e.target.dataset.action === "meal-name") {
      mealById(current.arg).name = e.target.value;
      saveMeals();
    }
  });
  $main.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input[data-action]")) e.target.blur(); // confirma o valor
  });

  // ------------------------------------------------------------------ zoom
  const $zImg = $zoom.querySelector("img");
  const $zCap = $zoom.querySelector(".zoom__cap");

  function zoomItems() {
    if (current.name === "measure") {
      const m = measureByCode.get(current.arg);
      return [{ src: m.photo, cap: `${m.code} – ${m.name}` }];
    }
    const s = byCode.get(current.arg);
    return rowLetters(s).map((L, j) => ({ L, src: photoOf(s, L), cap: `${s.code}-${L} · ${s.total[j]} g (edível ${s.edible[j]} g) · ${nf0.format(s.nutrition[j][N.kcal])} kcal` }))
      .filter((x) => x.src);
  }
  let zoomIdx = 0;
  function showZoom() {
    const items = zoomItems();
    const it = items[zoomIdx];
    $zImg.src = it.src; $zImg.alt = it.cap; $zCap.textContent = it.cap;
    $zoom.querySelector(".zoom__prev").hidden = zoomIdx === 0;
    $zoom.querySelector(".zoom__next").hidden = zoomIdx === items.length - 1;
  }
  function openZoom() {
    zoomIdx = Math.max(0, zoomItems().findIndex((x) => x.L === detailState.letter));
    showZoom();
    $zoom.showModal();
  }
  function moveZoom(dir) {
    const items = zoomItems();
    zoomIdx = Math.min(items.length - 1, Math.max(0, zoomIdx + dir));
    showZoom();
  }
  $zoom.addEventListener("close", () => {
    // sincroniza a foto escolhida na ampliação com a página
    const it = current.name === "serie" && zoomItems()[zoomIdx];
    if (it?.L && it.L !== detailState.letter) { selectLetter(it.L); render({ keepScroll: true }); }
  });
  $zoom.querySelector(".zoom__close").addEventListener("click", () => $zoom.close());
  $zoom.querySelector(".zoom__prev").addEventListener("click", () => moveZoom(-1));
  $zoom.querySelector(".zoom__next").addEventListener("click", () => moveZoom(1));
  $zoom.addEventListener("click", (e) => { if (e.target === $zoom) $zoom.close(); });
  $zoom.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") moveZoom(-1);
    if (e.key === "ArrowRight") moveZoom(1);
  });
  // deslizar para mudar de foto no telemóvel
  let touchX = null;
  $zoom.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $zoom.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) moveZoom(dx < 0 ? 1 : -1);
    touchX = null;
  });

  saveMeals(); // grava a migração do formato antigo, se tiver havido
  onRoute();
})();
