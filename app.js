/* Mapa Podróży — aplikacja działająca w 100% offline (PWA). */
"use strict";

const VERSION = "1.3.1";
const STORE_KEY = "mapa-podrozy-v1";
const SVG_NS = "http://www.w3.org/2000/svg";
const CONTINENTS = ["Europa", "Azja", "Afryka", "Ameryka Północna", "Ameryka Południowa", "Oceania"];
const COLORS = ["#2a9d8f", "#3a86ff", "#43aa8b", "#e76f51", "#e63946", "#8e5bd8", "#f4a261", "#d4a017"];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "");
const flag = (iso) => iso ? String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🏳️";
const fmtPct = (v) => (v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")) + "%";

let world;            // dane mapy
let byId = {};        // id kraju -> obiekt
let state;            // dane użytkownika
let citiesRaw = null; // surowe dane miast (string na kraj)
const citiesCache = {};

/* ================= Zapis danych ================= */
function defaultState() {
  return { visited: {}, cities: {}, color: COLORS[0], showCities: true, showGrid: true, showLabels: true, mapMode: "world", pinStyle: "pin", tipClosed: false };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object") return Object.assign(defaultState(), s);
  } catch (e) { /* brak lub uszkodzone dane */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("Nie udało się zapisać danych"); }
}

/* ================= Odwzorowanie mapy ================= */
// Mapa jest płaska (walcowe odwzorowanie Millera). Miasta trzymamy jako długość/szerokość geograficzną.
const RAD = Math.PI / 180;
function project(lon, lat) {
  const p = world.proj;
  return [p.tx + p.k * lon * RAD, p.ty - p.k * 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * RAD))];
}
function unproject(x, y) {
  const p = world.proj;
  const lon = (x - p.tx) / p.k / RAD;
  const lat = (2.5 * Math.atan(Math.exp(0.8 * (p.ty - y) / (p.k * 1.25))) - 0.625 * Math.PI) / RAD;
  return [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))];
}

// Wersja 1.0 zapisywała miasta jako punkty starej, zaokrąglonej mapy (Natural Earth, szer. 2000).
// Przeliczamy je odwrotnym odwzorowaniem na współrzędne geograficzne.
function naturalEarthInvert(x, y) {
  const k = 365.5792881403361, tx = 1000, ty = 519.9965089081433;
  const X = (x - tx) / k, Y = (ty - y) / k;
  let phi = Y, i = 25, delta, phi2;
  do {
    phi2 = phi * phi;
    const phi4 = phi2 * phi2;
    phi -= delta = (phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))) - Y) /
      (1.007226 + phi2 * (0.015085 * 3 + phi4 * (-0.044475 * 7 + 0.028874 * 9 * phi2 - 0.005916 * 11 * phi4)));
  } while (Math.abs(delta) > 1e-6 && --i > 0);
  phi2 = phi * phi;
  const lambda = X / (0.8707 + phi2 * (-0.131979 + phi2 * (-0.013791 + phi2 * phi2 * phi2 * (0.003971 - 0.001529 * phi2))));
  return [lambda / RAD, phi / RAD];
}
function migrateCities() {
  let changed = false;
  for (const id in state.cities) {
    for (const c of state.cities[id]) {
      if (c.x != null && c.lon == null) {
        const [lon, lat] = naturalEarthInvert(c.x, c.y);
        c.lon = +lon.toFixed(3);
        c.lat = +lat.toFixed(3);
        changed = true;
      }
      if ("x" in c || "y" in c) { delete c.x; delete c.y; changed = true; }
    }
  }
  return changed;
}

/* ================= Start ================= */
async function init() {
  state = load();
  applyColor();
  document.body.classList.toggle("no-cities", !state.showCities);
  document.body.classList.toggle("no-grid", !state.showGrid);
  $("#app-version").textContent = VERSION;

  const [w, pl] = await Promise.all([
    fetch("data/world.json").then((r) => r.json()),
    fetch("data/places.json").then((r) => r.json()).catch(() => []),
  ]);
  world = w;
  for (const c of world.countries) byId[c.id] = c;
  places = pl.map(([n, id, lon, lat, pop, cap]) => {
    const [x, y] = project(lon, lat);
    return { n, id, x, y, pop, cap, key: id + "|" + norm(n) };
  });
  labelOrder = world.countries.filter((c) => c.l).sort((a, b) => b.ar - a.ar);
  if (migrateCities()) save();
  $("#badge-total").textContent = world.countries.filter((c) => c.k).length;

  buildMap();
  initMapGestures();
  initUI();
  refreshAll();

  if ("serviceWorker" in navigator) {
    // Po pobraniu nowej wersji aplikacji przeładuj raz, żeby od razu jej używać
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
    }
    navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(() => {
      $("#offline-status").textContent = "gotowy ✓";
    }).catch(() => { $("#offline-status").textContent = "niedostępny"; });
  } else {
    $("#offline-status").textContent = "niedostępny";
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  if (!standalone && !state.tipClosed && /iPhone|iPad|iPod/.test(navigator.userAgent)) $("#install-tip").hidden = false;
}

/* ================= Mapa ================= */
const svg = $("#svg");
const mapEl = $("#map");
let vb0, vb;        // zatwierdzony i bieżący viewBox {x,y,w,h}
let cw = 1, ch = 1; // rozmiar kontenera w px
let selectedId = null;

function buildMap() {
  $("#sphere").setAttribute("d", world.sphere);
  $("#graticule").setAttribute("d", world.graticule);
  const gC = $("#countries"), gM = $("#markers");
  const fragC = document.createDocumentFragment(), fragM = document.createDocumentFragment();
  for (const c of world.countries) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", c.d);
    p.setAttribute("class", "c");
    p.dataset.id = c.id;
    fragC.appendChild(p);
    c.el = p;
    if (c.m) {
      const m = document.createElementNS(SVG_NS, "circle");
      m.setAttribute("cx", c.m[0]);
      m.setAttribute("cy", c.m[1]);
      m.setAttribute("class", "mk");
      m.dataset.id = c.id;
      fragM.appendChild(m);
      c.mk = m;
    }
    delete c.d; // nie trzymamy w pamięci dwa razy
  }
  gC.appendChild(fragC);
  gM.appendChild(fragM);

  measure();
  // Widok startowy: wysokość mapy wypełnia ekran, środek na Europie/Afryce
  const h = Math.min(world.h, world.w * ch / cw);
  const w = h * cw / ch;
  setView(clampView({ x: world.w * 0.53 - w / 2, y: (world.h - h) / 2, w, h }), true);
  window.addEventListener("resize", () => {
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, scale = vb.w / cw;
    measure();
    const w2 = cw * scale, h2 = ch * scale;
    setView(clampView({ x: cx - w2 / 2, y: cy - h2 / 2, w: w2, h: h2 }), true);
  });
}

function measure() {
  const r = mapEl.getBoundingClientRect();
  cw = Math.max(1, r.width);
  ch = Math.max(1, r.height);
}

function maxW() {
  // Maksymalne oddalenie: cały świat mieści się w ekranie
  return Math.max(world.w, world.h * cw / ch) * 1.02;
}
function minW() { return world.w / 80; }

function clampView(v) {
  let w = Math.min(maxW(), Math.max(minW(), v.w));
  const k = w / v.w;
  let h = v.h * k;
  let x = v.x + (v.w - w) / 2, y = v.y + (v.h - h) / 2;
  if (k === 1) { x = v.x; y = v.y; }
  // środek widoku musi pozostać nad mapą
  if (w >= world.w) x = (world.w - w) / 2;
  else x = Math.min(world.w - w, Math.max(0, x));
  if (h >= world.h) y = (world.h - h) / 2;
  else y = Math.min(world.h - h, Math.max(0, y));
  return { x, y, w, h };
}

// Podczas gestu przesuwamy/skalujemy warstwę CSS (płynnie, na GPU); po geście ustawiamy viewBox (ostro).
function setView(v, commit) {
  vb = v;
  if (commit) {
    vb0 = v;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    svg.style.transform = "";
    updateRadii();
    renderOverlay();
  } else {
    const k = vb0.w / v.w;
    const tx = (vb0.x - v.x) * cw / v.w, ty = (vb0.y - v.y) * ch / v.h;
    svg.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${k})`;
  }
}

let commitTimer = 0;
function scheduleCommit(delay = 120) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => setView(vb, true), delay);
}

function updateRadii() {
  const unit = vb.w / cw; // jednostki mapy na 1 px
  for (const c of world.countries) if (c.mk) c.mk.setAttribute("r", 4.5 * unit);
}

function toWorld(px, py) {
  return [vb.x + px * vb.w / cw, vb.y + py * vb.h / ch];
}

function zoomAt(factor, px, py, animate) {
  const [wx, wy] = toWorld(px, py);
  const w = vb.w / factor, h = vb.h / factor;
  const target = clampView({ x: wx - px * w / cw, y: wy - py * h / ch, w, h });
  animate ? animateTo(target) : setView(target, false);
}

let animId = 0;
function animateTo(target, ms = 380) {
  cancelAnimationFrame(animId);
  const from = { ...vb }, t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  // interpolacja logarytmiczna skali daje naturalne przybliżanie
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms), e = ease(t);
    const w = from.w * Math.pow(target.w / from.w, e);
    const h = w * ch / cw;
    const cx = from.x + from.w / 2 + (target.x + target.w / 2 - from.x - from.w / 2) * e;
    const cy = from.y + from.h / 2 + (target.y + target.h / 2 - from.y - from.h / 2) * e;
    setView({ x: cx - w / 2, y: cy - h / 2, w, h }, t === 1);
    if (t < 1) animId = requestAnimationFrame(step);
  };
  animId = requestAnimationFrame(step);
}

function flyToCountry(id) {
  const c = byId[id];
  const [x0, y0, x1, y1] = c.b;
  const pad = 1.6;
  let w = Math.max((x1 - x0) * pad, (y1 - y0) * pad * cw / ch, world.w / 40);
  const h = w * ch / cw;
  // arkusz zasłania dół ekranu — przesuwamy kraj trochę wyżej
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  animateTo(clampView({ x: cx - w / 2, y: cy - h / 2, w, h }), 600);
}

function initMapGestures() {
  const pts = new Map();
  let start = null; // stan początku gestu
  let tapCandidate = null;

  const resetStart = () => {
    const arr = [...pts.values()];
    if (arr.length === 1) {
      start = { vb: { ...vb }, x: arr[0].x, y: arr[0].y };
    } else if (arr.length >= 2) {
      const [a, b] = arr;
      start = { vb: { ...vb }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };
  const local = (e) => { const r = mapEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  mapEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(animId);
    clearTimeout(commitTimer);
    mapEl.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    tapCandidate = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    resetStart();
  });

  mapEl.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (tapCandidate && Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 8) tapCandidate = null;
    const arr = [...pts.values()];
    if (arr.length === 1 && start.x !== undefined) {
      const dx = arr[0].x - start.x, dy = arr[0].y - start.y;
      const s = start.vb;
      setView(clampView({ x: s.x - dx * s.w / cw, y: s.y - dy * s.h / ch, w: s.w, h: s.h }), false);
    } else if (arr.length >= 2 && start.dist) {
      const [a, b] = arr;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const s = start.vb;
      const w = Math.min(maxW(), Math.max(minW(), s.w * start.dist / dist));
      const h = w * ch / cw;
      const wx = s.x + start.mx * s.w / cw, wy = s.y + start.my * s.h / ch; // punkt pod palcami na starcie
      setView(clampView({ x: wx - mx * w / cw, y: wy - my * h / ch, w, h }), false);
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      if (tapCandidate && e.type === "pointerup" && performance.now() - tapCandidate.t < 500) {
        setView(vb, true);
        onMapTap(e.clientX, e.clientY);
      } else {
        scheduleCommit();
      }
      tapCandidate = null;
    } else {
      tapCandidate = null;
      resetStart();
    }
  };
  mapEl.addEventListener("pointerup", end);
  mapEl.addEventListener("pointercancel", end);

  mapEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    zoomAt(factor, p.x, p.y, false);
    scheduleCommit(150);
  }, { passive: false });

  // Blokada systemowego powiększania strony na iOS
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault());
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300 && e.target.closest && e.target.closest("#map")) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  $("#zoom-in").addEventListener("click", () => zoomAt(2, cw / 2, ch / 2, true));
  $("#zoom-out").addEventListener("click", () => zoomAt(0.5, cw / 2, ch / 2, true));
  $("#zoom-reset").addEventListener("click", () => {
    const w = maxW();
    animateTo(clampView({ x: 0, y: 0, w, h: w * ch / cw }));
  });
}

let placing = null; // { id, idx } — tryb umieszczania własnego miasta na mapie

function onMapTap(clientX, clientY) {
  if (placing) {
    const r = mapEl.getBoundingClientRect();
    const [lon, lat] = unproject(...toWorld(clientX - r.left, clientY - r.top));
    const list = state.cities[placing.id];
    const city = list && list[placing.idx];
    if (city) {
      city.lon = +lon.toFixed(3);
      city.lat = +lat.toFixed(3);
      save();
      renderOverlay();
      toast(`Umieszczono: ${city.n}`);
    }
    const id = placing.id;
    stopPlacing();
    openSheet(id);
    return;
  }
  const el = document.elementFromPoint(clientX, clientY);
  const hit = el && el.closest && el.closest("[data-id]");
  if (hit) openSheet(hit.dataset.id);
}

function startPlacing(id, idx) {
  placing = { id, idx };
  $("#place-name").textContent = state.cities[id][idx].n;
  $("#place-banner").hidden = false;
  document.body.classList.add("placing");
  $("#install-tip").hidden = true;
  closeSheet();
  showView("map");
  flyToCountry(id);
}
function stopPlacing() {
  placing = null;
  $("#place-banner").hidden = true;
  document.body.classList.remove("placing");
}

function paintCountry(c) {
  const v = !!state.visited[c.id];
  c.el.classList.toggle("v", v);
  if (c.mk) c.mk.classList.toggle("v", v);
}

/* ---------- miasta i nazwy na mapie ---------- */
let places = [];     // duże miasta i stolice {n, id, x, y, pop, cap, key}
let labelOrder = []; // kraje z etykietą, od największych

// Ile miast pokazywać przy danym przybliżeniu (unit = piksele ekranu na jednostkę mapy)
function minPopFor(unit) {
  if (unit < 0.6) return 5e6;
  if (unit < 0.9) return 2e6;
  if (unit < 1.2) return 1e6;
  if (unit < 2.5) return 3e5;
  if (unit < 5) return 1.5e5;
  return 0;
}

// Dwa tryby mapy:
//  „world”  — kolory krajów, nazwy krajów, duże miasta jako małe czarne kropki (bez wyróżnień);
//  „cities” — przygaszona mapa i tylko odwiedzone miasta (pinezki albo kolorowe kropki) z nazwami.
function renderOverlay() {
  if (!vb) return;
  const gDots = $("#city-dots"), gLbl = $("#labels");
  const unit = cw / vb.w, inv = 1 / unit;
  const pad = 30;
  const sx = (x) => (x - vb.x) * unit, sy = (y) => (y - vb.y) * unit;
  const inView = (x, y) => { const a = sx(x), b = sy(y); return a > -pad && a < cw + pad && b > -pad && b < ch + pad; };
  const boxes = [];
  const overlaps = (b, list) => list.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  let lbl = "", dots = "";
  const text = (x, y, t, cls, fs, anchor) =>
    `<text x="${x}" y="${y}" class="${cls}" font-size="${fs * inv}" stroke-width="${3 * inv}"${anchor ? ` text-anchor="${anchor}"` : ""}>${esc(t)}</text>`;
  // nazwa miasta po prawej, a gdy brak miejsca — po lewej (dx: odstęp od punktu w px, dy: przesunięcie w pionie)
  const cityName = (c, cls, fs, dx, dy) => {
    const w = c.n.length * fs * 0.56 + 2, a = sx(c.x), b = sy(c.y) + dy;
    const right = [a + dx, b - fs * 0.6, a + dx + w, b + fs * 0.6];
    const left = [a - dx - w, b - fs * 0.6, a - dx, b + fs * 0.6];
    const ty = c.y + (dy + fs * 0.35) * inv;
    if (!overlaps(right, boxes)) { boxes.push(right); lbl += text(c.x + dx * inv, ty, c.n, cls, fs); }
    else if (!overlaps(left, boxes)) { boxes.push(left); lbl += text(c.x - dx * inv, ty, c.n, cls, fs, "end"); }
  };
  const citiesMode = state.mapMode === "cities";

  // 1. Nazwy krajów (najpierw największe)
  if (state.showLabels) {
    for (const c of labelOrder) {
      const [x, y, minUnit, fs] = c.l;
      if (unit < minUnit || !inView(x, y)) continue;
      const name = c.n.toUpperCase();
      const w = name.length * fs * 0.68 + 4, a = sx(x), b = sy(y);
      const box = [a - w / 2, b - fs * 0.7, a + w / 2, b + fs * 0.7];
      if (overlaps(box, boxes)) continue;
      // w trybie miast nazwy krajów nie blokują miejsca nazwom miast
      if (!citiesMode) boxes.push(box);
      lbl += text(x, y + fs * 0.35 * inv, name, "lc", fs, "middle");
    }
  }

  if (citiesMode) {
    // 2a. Tylko odwiedzone miasta
    const list = [];
    for (const id in state.cities) {
      for (const c of state.cities[id]) {
        if (c.lon == null) continue;
        const [x, y] = project(c.lon, c.lat);
        if (inView(x, y)) list.push({ n: c.n, x, y });
      }
    }
    const pins = state.pinStyle !== "dot";
    list.sort((a, b) => a.y - b.y); // południowe pinezki na wierzchu
    for (const c of list) {
      dots += pins
        ? `<g transform="translate(${c.x} ${c.y}) scale(${inv})" class="pin"><path d="M0 0C-1.6-5-8-8.6-8-14.6a8 8 0 1 1 16 0C8-8.6 1.6-5 0 0Z"/><circle cy="-14.6" r="3"/></g>`
        : `<circle cx="${c.x}" cy="${c.y}" r="${4.5 * inv}" class="vd"/>`;
    }
    // nazwy: gdy jest miejsce; przy pinezkach obok główki pinezki
    for (const c of list.slice().reverse()) cityName(c, "lp v", 12, pins ? 10 : 7, pins ? -14.6 : 0);
  } else if (state.showCities) {
    // 2b. Duże miasta jako małe czarne kropki — więcej przy większym przybliżeniu
    const minPop = minPopFor(unit);
    const gap = unit < 1 ? 6 : unit < 3 ? 3 : 1;
    const dotBoxes = [], placed = [];
    for (const p of places) { // posortowane: stolice, potem wg liczby mieszkańców
      if ((!p.cap || unit < 0.6) && p.pop < minPop) continue;
      if (!inView(p.x, p.y)) continue;
      const a = sx(p.x), b = sy(p.y), r = 2;
      const db = [a - r - gap, b - r - gap, a + r + gap, b + r + gap];
      if (overlaps(db, dotBoxes)) continue;
      dotBoxes.push(db);
      placed.push(p);
      dots += `<circle cx="${p.x}" cy="${p.y}" r="${r * inv}" class="bd"/>`;
    }
    if (unit >= 0.7) {
      for (const p of placed) {
        if (!p.cap && p.pop < 1e6 && unit < 1.5) continue;
        cityName(p, "lp", 11, 4, 0);
      }
    }
  }
  gDots.innerHTML = dots;
  gLbl.innerHTML = lbl;
}

function setMapMode(mode) {
  state.mapMode = mode;
  save();
  document.body.dataset.mode = mode;
  for (const b of $("#mode-switch").children) b.classList.toggle("on", b.dataset.mode === mode);
  refreshCounters();
  renderOverlay();
}

function selectCountry(id) {
  if (selectedId && byId[selectedId]) {
    byId[selectedId].el.classList.remove("sel");
    if (byId[selectedId].mk) byId[selectedId].mk.classList.remove("sel");
  }
  selectedId = id;
  if (id) {
    const c = byId[id];
    c.el.classList.add("sel");
    c.el.parentNode.appendChild(c.el); // obrys na wierzchu
    if (c.mk) c.mk.classList.add("sel");
  }
}

/* ================= Logika odwiedzin ================= */
function setVisited(id, on) {
  if (on) state.visited[id] = state.visited[id] || Date.now();
  else {
    delete state.visited[id];
    delete state.cities[id];
  }
  save();
  paintCountry(byId[id]);
  if (!on) renderOverlay();
  refreshCounters();
}

function addCity(id, city) {
  const list = (state.cities[id] ||= []);
  if (list.some((c) => norm(c.n) === norm(city.n))) { toast(`${city.n} jest już na liście`); return false; }
  list.push(city);
  const wasVisited = !!state.visited[id];
  if (!wasVisited) state.visited[id] = Date.now();
  save();
  paintCountry(byId[id]);
  renderOverlay();
  refreshCounters();
  toast(wasVisited ? `Dodano: ${city.n}` : `Dodano: ${city.n} · ${byId[id].n} odwiedzony`);
  return true;
}

function removeCity(id, idx) {
  const list = state.cities[id];
  if (!list) return;
  const [c] = list.splice(idx, 1);
  if (!list.length) delete state.cities[id];
  save();
  renderOverlay();
  refreshCounters();
  toast(`Usunięto: ${c.n}`);
}

/* ================= Baza miast ================= */
async function loadCities() {
  if (citiesRaw) return;
  citiesRaw = await fetch("data/cities.json").then((r) => r.json());
}
function citiesOf(id) {
  if (citiesCache[id]) return citiesCache[id];
  if (!citiesRaw) return [];
  const raw = citiesRaw[id];
  const arr = raw ? raw.split("\n").map((line) => {
    const [n, pl, lon, lat, pop] = line.split("|");
    const show = pl || n;
    return { n: show, alt: pl && pl !== n ? n : "", lon: +lon, lat: +lat, pop: +pop, key: norm(show) + " " + norm(n) };
  }) : [];
  return (citiesCache[id] = arr);
}

/* ================= Interfejs ================= */
function initUI() {
  // karty
  $("#tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) showView(b.dataset.view);
  });
  $("#map-badge").addEventListener("click", () => showView("stats"));
  $("#mode-switch").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b && b.dataset.mode !== state.mapMode) setMapMode(b.dataset.mode);
  });
  document.body.dataset.mode = state.mapMode;
  for (const b of $("#mode-switch").children) b.classList.toggle("on", b.dataset.mode === state.mapMode);
  $("#pin-style").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-p]");
    if (!b) return;
    state.pinStyle = b.dataset.p; save();
    for (const x of $("#pin-style").children) x.classList.toggle("on", x === b);
    renderOverlay();
  });
  for (const x of $("#pin-style").children) x.classList.toggle("on", x.dataset.p === state.pinStyle);
  $("#place-cancel").addEventListener("click", () => { const id = placing && placing.id; stopPlacing(); if (id) openSheet(id); });
  $("#install-close").addEventListener("click", () => { $("#install-tip").hidden = true; state.tipClosed = true; save(); });

  // lista
  $("#list-search").addEventListener("input", renderList);
  $("#list-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    for (const x of $("#list-filter").children) x.classList.toggle("on", x === b);
    listFilter = b.dataset.f;
    renderList();
  });
  $("#list-body").addEventListener("click", (e) => {
    const chk = e.target.closest(".check");
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (chk) {
      const on = !state.visited[id];
      if (!on && !confirmUnvisit(id)) return;
      setVisited(id, on);
      if (navigator.vibrate) navigator.vibrate(10);
    } else {
      openSheet(id);
    }
  });
  $("#list-search").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

  // ustawienia
  renderSwatches();
  $("#opt-cities").checked = state.showCities;
  $("#opt-cities").addEventListener("change", (e) => {
    state.showCities = e.target.checked; save();
    document.body.classList.toggle("no-cities", !state.showCities);
    renderOverlay();
  });
  $("#opt-labels").checked = state.showLabels;
  $("#opt-labels").addEventListener("change", (e) => { state.showLabels = e.target.checked; save(); renderOverlay(); });
  $("#opt-grid").checked = state.showGrid;
  $("#opt-grid").addEventListener("change", (e) => {
    state.showGrid = e.target.checked; save();
    document.body.classList.toggle("no-grid", !state.showGrid);
  });
  $("#btn-export").addEventListener("click", exportData);
  $("#btn-import").addEventListener("click", () => $("#file-import").click());
  $("#file-import").addEventListener("change", importData);
  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Na pewno usunąć wszystkie odwiedzone kraje i miasta? Tej operacji nie można cofnąć.")) return;
    const keep = { color: state.color, showCities: state.showCities, showGrid: state.showGrid, showLabels: state.showLabels, mapMode: state.mapMode, pinStyle: state.pinStyle, tipClosed: state.tipClosed };
    state = Object.assign(defaultState(), keep);
    save();
    refreshAll();
    toast("Usunięto wszystkie dane");
  });

  // arkusz
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#backdrop").addEventListener("click", () => { if (performance.now() - sheetOpenedAt > 400) closeSheet(); });
  $("#visit-btn").addEventListener("click", () => {
    const id = sheetId;
    const on = !state.visited[id];
    if (!on && !confirmUnvisit(id)) return;
    setVisited(id, on);
    if (navigator.vibrate) navigator.vibrate(10);
    renderSheet();
  });
  $("#show-on-map").addEventListener("click", () => {
    const id = sheetId;
    closeSheet();
    showView("map");
    selectCountry(id);
    requestAnimationFrame(() => flyToCountry(id));
  });
  $("#city-input").addEventListener("input", renderSuggest);
  $("#city-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("#city-suggest .chip");
      if (first && e.target.value.trim()) first.click();
      else e.target.blur();
    }
  });
  $("#city-suggest").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    let city;
    if (chip.dataset.custom != null) {
      city = { n: chip.dataset.custom, own: 1, t: Date.now() };
    } else {
      const c = citiesOf(sheetId)[+chip.dataset.i];
      city = { n: c.n, lon: c.lon, lat: c.lat, t: Date.now() };
      if (c.alt) city.alt = c.alt;
    }
    if (addCity(sheetId, city)) {
      $("#city-input").value = "";
      renderSheet();
    }
  });
  $("#city-list").addEventListener("click", (e) => {
    const row = e.target.closest(".city-row");
    if (!row) return;
    const idx = +row.dataset.i;
    if (e.target.closest(".del")) { removeCity(sheetId, idx); renderSheet(); }
    else if (e.target.closest(".pin")) startPlacing(sheetId, idx);
  });
  initSheetDrag();
}

function confirmUnvisit(id) {
  const n = (state.cities[id] || []).length;
  if (!n) return true;
  return confirm(`Odznaczyć ${byId[id].n}? Usunie to również ${n} ${plural(n, "miasto", "miasta", "miast")} z listy.`);
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
}

let currentView = "map";
function showView(name) {
  currentView = name;
  for (const v of document.querySelectorAll(".view")) v.classList.toggle("active", v.id === "view-" + name);
  for (const b of $("#tabbar").children) b.classList.toggle("on", b.dataset.view === name);
  if (name === "stats") renderStats();
  if (name === "list") renderList();
  if (name === "map") {
    // po powrocie do mapy rozmiar mógł się zmienić
    requestAnimationFrame(() => { measure(); setView(clampView({ ...vb, h: vb.w * ch / cw }), true); });
  }
}

function refreshAll() {
  for (const c of world.countries) paintCountry(c);
  renderOverlay();
  refreshCounters();
  renderSwatches();
  $("#opt-cities").checked = state.showCities;
  $("#opt-grid").checked = state.showGrid;
  $("#opt-labels").checked = state.showLabels;
  document.body.classList.toggle("no-cities", !state.showCities);
  document.body.classList.toggle("no-grid", !state.showGrid);
  applyColor();
}

function computeStats() {
  const counted = world.countries.filter((c) => c.k);
  const visited = counted.filter((c) => state.visited[c.id]);
  const terr = world.countries.filter((c) => !c.k);
  const terrVisited = terr.filter((c) => state.visited[c.id]);
  const all = world.countries.filter((c) => state.visited[c.id]);
  const worldPop = counted.reduce((s, c) => s + c.pop, 0) + terr.reduce((s, c) => s + c.pop, 0);
  const pop = all.reduce((s, c) => s + c.pop, 0);
  const area = all.reduce((s, c) => s + c.ar, 0);
  const conts = new Set(all.map((c) => c.c));
  let cities = 0;
  for (const id in state.cities) cities += state.cities[id].length;
  const perCont = CONTINENTS.map((name) => {
    const list = counted.filter((c) => c.c === name);
    return { name, total: list.length, v: list.filter((c) => state.visited[c.id]).length };
  });
  return { total: counted.length, visited: visited.length, terr: terr.length, terrVisited: terrVisited.length,
    popPct: worldPop ? pop / worldPop * 100 : 0, areaPct: area * 100, conts: conts.size, cities, perCont };
}

function refreshCounters() {
  const s = computeStats();
  // W trybie „Miasta” plakietka pokazuje liczbę odwiedzonych miast
  const cm = state.mapMode === "cities";
  $("#badge-visited").textContent = cm ? s.cities : s.visited;
  $("#badge-of").hidden = cm;
  $("#badge-pct").hidden = cm;
  $("#badge-pct").textContent = fmtPct(s.visited / s.total * 100);
  $("#badge-label").textContent = cm ? plural(s.cities, "miasto", "miasta", "miast") : "krajów";
  if (currentView === "stats") renderStats();
  if (currentView === "list") renderList();
}

/* ---------- lista krajów ---------- */
let listFilter = "all";
function renderList() {
  const q = norm($("#list-search").value.trim());
  const groups = [...CONTINENTS.map((n) => ({ name: n, items: [] })), { name: "Terytoria i inne", items: [], terr: true }];
  for (const c of world.countries) {
    const v = !!state.visited[c.id];
    if (listFilter === "v" && !v) continue;
    if (listFilter === "n" && v) continue;
    if (q && !norm(c.n).includes(q) && !norm(c.en).includes(q)) continue;
    const g = c.k ? groups.find((g) => g.name === c.c) : groups[groups.length - 1];
    g.items.push(c);
  }
  let html = "";
  for (const g of groups) {
    if (!g.items.length) continue;
    const all = world.countries.filter((c) => (g.terr ? !c.k : c.k && c.c === g.name));
    const vis = all.filter((c) => state.visited[c.id]).length;
    html += `<div class="cont-head">${esc(g.name)}<span>${vis} / ${all.length}</span></div><div class="card">`;
    for (const c of g.items) {
      const v = !!state.visited[c.id];
      const nc = (state.cities[c.id] || []).length;
      html += `<div class="crow" data-id="${c.id}" role="button">
        <span class="crow-flag">${flag(c.iso)}</span>
        <span class="crow-main">
          <span class="crow-name">${esc(c.n)}${c.k ? "" : `<small>${c.s ? esc(byId[c.s].n) : c.id === "ATA" ? "kontynent" : "obszar sporny"}</small>`}</span>
          ${nc ? `<span class="pill">${nc} ${plural(nc, "miasto", "miasta", "miast")}</span>` : ""}
          <button type="button" class="check${v ? " on" : ""}" aria-label="${v ? "Odznacz" : "Oznacz jako odwiedzony"}"><i></i></button>
        </span>
      </div>`;
    }
    html += `</div>`;
  }
  $("#list-body").innerHTML = html || `<div class="empty">Brak wyników</div>`;
}

/* ---------- statystyki ---------- */
function renderStats() {
  const s = computeStats();
  const pct = s.visited / s.total * 100;
  const R = 54, C = 2 * Math.PI * R;
  const top = Object.entries(state.cities).map(([id, l]) => ({ c: byId[id], n: l.length }))
    .filter((x) => x.c).sort((a, b) => b.n - a.n).slice(0, 5);
  $("#stats-body").innerHTML = `
    <div class="card hero">
      <div class="ring">
        <svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="${R}" fill="none" stroke-width="12"/>
        <circle class="fg" cx="60" cy="60" r="${R}" fill="none" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg>
        <div class="ring-txt"><b>${fmtPct(pct)}</b><span>świata</span></div>
      </div>
      <div class="hero-side">
        <div><b>${s.visited}</b><span>${plural(s.visited, "kraj odwiedzony", "kraje odwiedzone", "krajów odwiedzonych")}</span></div>
        <div><b>${s.total - s.visited}</b><span>pozostało z ${s.total}</span></div>
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><b>${s.cities}</b><span>${plural(s.cities, "miasto", "miasta", "miast")}</span></div>
      <div class="tile"><b>${s.conts}<small class="muted" style="font-size:16px"> / 7</small></b><span>kontynentów</span></div>
      <div class="tile"><b>${fmtPct(s.areaPct)}</b><span>powierzchni lądów</span></div>
      <div class="tile"><b>${fmtPct(s.popPct)}</b><span>ludności świata</span></div>
    </div>
    <div class="group-title">Kontynenty</div>
    <div class="card bars">
      ${s.perCont.map((p) => `<div class="bar-row">
        <div class="bar-top">${esc(p.name)}<span>${p.v} / ${p.total} · zostało ${p.total - p.v}</span></div>
        <div class="bar"><i style="width:${p.total ? p.v / p.total * 100 : 0}%"></i></div></div>`).join("")}
    </div>
    <div class="group-title">Terytoria zależne i inne</div>
    <div class="card"><div class="row"><span>Odwiedzone terytoria</span><span class="muted">${s.terrVisited} / ${s.terr}</span></div></div>
    ${top.length ? `<div class="group-title">Najwięcej miast</div><div class="card">
      ${top.map((t) => `<div class="row top-row" data-id="${t.c.id}"><span class="crow-flag">${flag(t.c.iso)}</span><span style="flex:1">${esc(t.c.n)}</span><span class="muted">${t.n}</span></div>`).join("")}
    </div>` : ""}
    <p class="hint">Liczone są 193 państwa ONZ oraz Watykan, Palestyna, Kosowo i Tajwan.</p>`;
  for (const r of $("#stats-body").querySelectorAll(".top-row")) r.addEventListener("click", () => openSheet(r.dataset.id));
}

/* ---------- kolory ---------- */
function applyColor() {
  document.documentElement.style.setProperty("--visited", state.color);
  document.documentElement.style.setProperty("--accent", state.color);
}
function renderSwatches() {
  const isCustom = !COLORS.includes(state.color);
  $("#swatches").innerHTML = COLORS.map((c) =>
    `<button type="button" class="swatch${c === state.color ? " on" : ""}" style="background:${c}" data-c="${c}" aria-label="Kolor ${c}"></button>`
  ).join("") + `<label class="swatch swatch-custom${isCustom ? " on" : ""}" aria-label="Własny kolor"><input type="color" value="${isCustom ? state.color : "#2a9d8f"}"></label>`;
  $("#swatches").onclick = (e) => {
    const b = e.target.closest("button[data-c]");
    if (!b) return;
    state.color = b.dataset.c; save(); applyColor(); renderSwatches();
  };
  $("#swatches input").oninput = (e) => { state.color = e.target.value; save(); applyColor(); };
  $("#swatches input").onchange = () => renderSwatches();
}

/* ---------- arkusz kraju ---------- */
let sheetId = null, sheetOpenedAt = 0;
async function openSheet(id) {
  if (!byId[id]) return;
  sheetId = id;
  sheetOpenedAt = performance.now();
  selectCountry(id);
  $("#city-input").value = "";
  renderSheet();
  const sheet = $("#sheet"), bd = $("#backdrop");
  sheet.hidden = false; bd.hidden = false;
  sheet.style.transform = "";
  requestAnimationFrame(() => { sheet.classList.add("show"); bd.classList.add("show"); });
  $("#sheet-body").scrollTop = 0;
  if (!citiesRaw) {
    try { await loadCities(); } catch (e) { /* bez bazy można dodać własne miasto */ }
    if (sheetId === id) renderSuggest();
  }
}
function closeSheet() {
  const sheet = $("#sheet"), bd = $("#backdrop");
  if (sheet.hidden) return;
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  sheet.classList.remove("show"); bd.classList.remove("show");
  sheet.style.transform = "";
  setTimeout(() => { if (!sheet.classList.contains("show")) { sheet.hidden = true; bd.hidden = true; } }, 300);
  selectCountry(null);
}
function renderSheet() {
  const c = byId[sheetId];
  const v = !!state.visited[c.id];
  $("#sheet-flag").textContent = flag(c.iso);
  $("#sheet-name").textContent = c.n;
  $("#sheet-sub").textContent = c.k ? c.c : c.id === "ATA" ? "Kontynent" : `${c.c} · ${c.s ? `terytorium (${byId[c.s].n})` : "obszar sporny"}`;
  const btn = $("#visit-btn");
  btn.classList.toggle("on", v);
  btn.textContent = v ? "✓ Odwiedzony" : "Byłem tutaj";
  const list = state.cities[c.id] || [];
  $("#city-count").textContent = list.length ? list.length : "";
  $("#city-list").innerHTML = list.map((city, i) => `<div class="city-row" data-i="${i}">
      <span class="nm">${esc(city.n)}${city.alt ? `<small>${esc(city.alt)}</small>` : city.own && city.lon == null ? `<small>nie ma go na mapie</small>` : ""}</span>
      ${city.own && city.lon == null ? `<button type="button" class="pin">Wskaż na mapie</button>` : ""}
      <button type="button" class="del" aria-label="Usuń ${esc(city.n)}">✕</button>
    </div>`).join("");
  renderSuggest();
}
function renderSuggest() {
  const box = $("#city-suggest");
  const q = $("#city-input").value.trim();
  const qn = norm(q);
  const have = new Set((state.cities[sheetId] || []).map((c) => norm(c.n)));
  const all = citiesOf(sheetId);
  let html = "";
  if (!q) {
    const top = [];
    for (let i = 0; i < all.length && top.length < 8; i++) if (!have.has(norm(all[i].n))) top.push(i);
    box.classList.remove("listmode");
    if (top.length) html = `<div class="suggest-label">Największe miasta — stuknij, aby dodać</div>` +
      top.map((i) => `<button type="button" class="chip" data-i="${i}">${esc(all[i].n)}</button>`).join("");
  } else {
    const starts = [], contains = [];
    for (let i = 0; i < all.length; i++) {
      const k = all[i].key;
      if (have.has(norm(all[i].n))) continue;
      if (k.startsWith(qn) || k.includes(" " + qn)) starts.push(i);
      else if (k.includes(qn)) contains.push(i);
      if (starts.length >= 8) break;
    }
    const res = starts.concat(contains).slice(0, 8);
    box.classList.add("listmode");
    html = res.map((i) => `<button type="button" class="chip" data-i="${i}"><span>${esc(all[i].n)}${all[i].alt ? `<small>${esc(all[i].alt)}</small>` : ""}</span><small>${fmtPop(all[i].pop)}</small></button>`).join("");
    const exact = res.some((i) => norm(all[i].n) === qn);
    if (!exact && !have.has(qn)) html += `<button type="button" class="chip custom" data-custom="${esc(q)}">+ Dodaj „${esc(q)}” jako własne miejsce</button>`;
  }
  box.innerHTML = html;
}
function fmtPop(p) {
  if (!p) return "";
  if (p >= 1e6) return (p / 1e6).toFixed(1).replace(".", ",") + " mln";
  if (p >= 1e3) return Math.round(p / 1e3) + " tys.";
  return String(p);
}

// Zamykanie arkusza przeciągnięciem w dół
function initSheetDrag() {
  const sheet = $("#sheet");
  let y0 = null, dy = 0;
  const startDrag = (e) => { y0 = e.clientY; dy = 0; sheet.classList.add("dragging"); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; };
  const stop = () => {
    if (y0 == null) return;
    y0 = null; sheet.classList.remove("dragging");
    if (dy > 90) closeSheet(); else sheet.style.transform = "";
  };
  for (const el of [$("#sheet-grip"), $(".sheet-head")]) {
    el.addEventListener("pointerdown", (e) => { if (!e.target.closest("button")) startDrag(e); });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }
}

/* ---------- kopia zapasowa ---------- */
async function exportData() {
  const data = { app: "mapa-podrozy", version: 1, exported: new Date().toISOString(),
    visited: state.visited, cities: state.cities, color: state.color };
  const name = `mapa-podrozy-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Kopia Mapy Podróży" });
      return;
    }
  } catch (e) {
    if (e.name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(e) {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d.visited !== "object" || typeof d.cities !== "object") throw new Error("format");
      const nv = Object.keys(d.visited).filter((id) => byId[id]).length;
      if (!confirm(`Zaimportować kopię z ${nv} ${plural(nv, "krajem", "krajami", "krajami")}? Obecne dane zostaną zastąpione.`)) return;
      state.visited = {}; state.cities = {};
      for (const id in d.visited) if (byId[id]) state.visited[id] = d.visited[id];
      for (const id in d.cities) if (byId[id] && Array.isArray(d.cities[id])) state.cities[id] = d.cities[id].filter((c) => c && c.n);
      migrateCities();
      if (typeof d.color === "string" && /^#[0-9a-f]{6}$/i.test(d.color)) state.color = d.color;
      save();
      refreshAll();
      toast("Zaimportowano dane");
    } catch (err) {
      alert("To nie jest poprawny plik kopii Mapy Podróży.");
    }
  };
  r.readAsText(f);
}

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => { if (!t.classList.contains("show")) t.hidden = true; }, 250); }, 2200);
}

/* ---------- niespodzianka ---------- */
// 12 szybkich stuknięć w numer wersji (każde najwyżej 0,6 s po poprzednim)
(() => {
  let taps = 0, last = 0;
  $("#version-row").addEventListener("click", () => {
    const now = performance.now();
    taps = now - last < 600 ? taps + 1 : 1;
    last = now;
    if (taps >= 12) { taps = 0; showHearts(); }
  });
})();

function showHearts() {
  if ($("#hearts")) return;
  const HEART = "M12 21.3 10.6 20C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.3Z";
  const colors = ["#ff4d6d", "#ff758f", "#ff8fa3", "#e63946", "#f72585", "#ffb3c1", "#c9184a"];
  const box = document.createElement("div");
  box.id = "hearts";
  box.className = "hearts";
  let html = "";
  for (let i = 0; i < 46; i++) {
    const size = 16 + Math.random() * 34;
    html += `<svg class="fh" viewBox="0 0 24 24" style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;` +
      `--d:${3.5 + Math.random() * 3.5}s;--delay:${(Math.random() * 2.5).toFixed(2)}s;--sway:${(Math.random() * 60 - 30).toFixed(0)}px;` +
      `--rot:${(Math.random() * 50 - 25).toFixed(0)}deg;fill:${colors[i % colors.length]}"><path d="${HEART}"/></svg>`;
  }
  html += `<div class="big-heart"><svg viewBox="0 0 24 24"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ff758f"/><stop offset="1" stop-color="#d00045"/></linearGradient></defs>` +
    `<path d="${HEART}" fill="url(#hg)"/></svg><span>G+D</span></div>`;
  box.innerHTML = html;
  document.body.appendChild(box);
  if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
  const close = () => {
    box.classList.add("out");
    setTimeout(() => box.remove(), 500);
  };
  box.addEventListener("click", close);
  setTimeout(close, 7000);
}

init().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<p style="padding:40px 20px;font:16px -apple-system,sans-serif">Nie udało się uruchomić aplikacji: ${esc(e.message)}</p>`;
});
