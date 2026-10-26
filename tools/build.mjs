// Generuje dane mapy (app/data/world.json) i miast (app/data/cities.json).
// Uruchom: node build.mjs   (wymaga plików w tools/raw — patrz README)
import fs from "node:fs";
import { createRequire } from "node:module";
import * as d3 from "d3-geo";
import { geoMiller } from "d3-geo-projection";

const require = createRequire(import.meta.url);
const OUT = new URL("../data/", import.meta.url);
const W = 2000;

const ne = JSON.parse(fs.readFileSync(new URL("raw/ne_50m_admin_0_countries.geojson", import.meta.url)));
const places = JSON.parse(fs.readFileSync(new URL("raw/ne_10m_populated_places.geojson", import.meta.url)));
const cities = require("all-the-cities");

// --- Które obiekty liczymy jako „kraje” (193 państwa ONZ + Watykan, Palestyna, Kosowo, Tajwan = 197)
const DROP = new Set(["KAS", "IOA", "ATC"]); // drobne obszary bez sensu na liście
const COUNTED_EXTRA = new Set(["USA", "GBR", "NZL", "NLD", "FRA", "FIN", "CHN", "DNK", "AUS", "ISR", "KOS", "PSX"]);
const NOT_COUNTED = new Set(["SOL", "CYN"]);

const NAME_FIX = {
  TWN: "Tajwan", CHN: "Chiny", ZAF: "Republika Południowej Afryki", MMR: "Mjanma (Birma)",
  COD: "Demokratyczna Republika Konga", COG: "Kongo", USA: "Stany Zjednoczone",
  STP: "Wyspy Świętego Tomasza i Książęca", CZE: "Czechy", SWZ: "Eswatini",
  TLS: "Timor Wschodni", CIV: "Wybrzeże Kości Słoniowej", PSX: "Palestyna",
  KOS: "Kosowo", SAH: "Sahara Zachodnia", CYN: "Cypr Północny", SOL: "Somaliland",
  ATF: "Francuskie Terytoria Południowe", SGS: "Georgia Płd. i Sandwich Płd.",
  IOT: "Brytyjskie Terytorium Oceanu Indyjskiego", VIR: "Wyspy Dziewicze USA",
};
const CONT = {
  "Europe": "Europa", "Asia": "Azja", "Africa": "Afryka", "North America": "Ameryka Północna",
  "South America": "Ameryka Południowa", "Oceania": "Oceania", "Antarctica": "Antarktyda",
};
const CONT_FIX = { CYP: "Europa", SYC: "Afryka", MUS: "Afryka", MDV: "Azja", SHN: "Afryka",
  IOT: "Azja", ATF: "Antarktyda", HMD: "Antarktyda", SGS: "Antarktyda" };

// Płaska, prostokątna mapa (odwzorowanie walcowe Millera)
const projection = geoMiller().fitWidth(W, { type: "Sphere" });
const path = d3.geoPath(projection).digits(1);
const H = Math.ceil(path.bounds({ type: "Sphere" })[1][1]);

// Zamiana ścieżki z absolutnymi współrzędnymi na względne w dziesiątych częściach (mniejszy plik).
function compact(d) {
  let out = "", cx = 0, cy = 0, sx = 0, sy = 0;
  const num = (v) => String(v).replace(/^(-?)0\./, "$1.");
  const push = (v) => { const t = num(v); out += (out && !/[mz]$/.test(out) && !t.startsWith("-") ? " " : "") + t; };
  for (const seg of d.match(/[MLZ][^MLZ]*/g)) {
    const cmd = seg[0];
    if (cmd === "Z") { out += "z"; cx = sx; cy = sy; continue; } // po „z” punkt wraca na początek
    const [x, y] = seg.slice(1).split(",").map(Number);
    const X = Math.round(x * 10), Y = Math.round(y * 10);
    if (cmd === "L" && X === cx && Y === cy) continue;
    if (cmd === "M") out += "m"; // kolejne pary po „m” to w SVG względne linie
    push((X - cx) / 10); push((Y - cy) / 10);
    cx = X; cy = Y;
    if (cmd === "M") { sx = X; sy = Y; }
  }
  return out;
}

function polygons(geom) {
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}

const countries = [];
let totalArea = 0;
for (const f of ne.features) {
  const p = f.properties;
  const id = p.ADM0_A3;
  if (DROP.has(id)) continue;
  const iso = /^[A-Z]{2}$/.test(p.ISO_A2_EH) ? p.ISO_A2_EH : null;
  const counted = !NOT_COUNTED.has(id) &&
    (p.TYPE === "Sovereign country" || p.TYPE === "Sovereignty" || COUNTED_EXTRA.has(id));
  const d = compact(path(f));
  const area = d3.geoArea(f);
  totalArea += area;

  // bbox i środek: z największych części (żeby np. Alaska/Aleuty nie rozciągały ramki przez cały świat)
  const parts = polygons(f.geometry).map((c) => {
    const g = { type: "Polygon", coordinates: c };
    return { g, a: path.area(g) };
  }).sort((a, b) => b.a - a.a);
  const big = parts.filter((q) => q.a >= parts[0].a * 0.08);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of big) {
    const [[a, b], [c, e]] = path.bounds(q.g);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, e);
  }
  const [mx, my] = path.centroid(parts[0].g);
  const projArea = path.area(f);

  countries.push({
    id, iso,
    n: NAME_FIX[id] || p.NAME_PL || p.NAME,
    en: p.NAME,
    c: CONT_FIX[id] || CONT[p.CONTINENT] || "Oceania",
    k: counted ? 1 : 0,
    pop: p.POP_EST || 0,
    ar: area,
    b: [x0, y0, x1, y1].map((v) => Math.round(v * 10) / 10),
    m: counted && projArea < 6 ? [Math.round(mx * 10) / 10, Math.round(my * 10) / 10] : undefined,
    s: counted ? undefined : p.SOVEREIGNT, // zamieniane niżej na id państwa
    d,
  });
}
for (const c of countries) c.ar = +(c.ar / totalArea).toFixed(6);
// Państwo zwierzchnie terytorium: angielska nazwa -> id (sporne obszary bez zwierzchnika)
for (const c of countries) {
  if (!c.s) continue;
  const sov = countries.find((o) => o.k && o.en === c.s);
  c.s = sov ? sov.id : undefined;
}

const counted = countries.filter((c) => c.k).length;
console.log("obiekty:", countries.length, "liczone kraje:", counted);
if (counted !== 197) throw new Error("Oczekiwano 197 krajów, jest " + counted);

const graticule = compact(path(d3.geoGraticule().step([30, 30]).extent([[-180, -90], [180, 90.01]])()));
const sphere = compact(path({ type: "Sphere" }));
countries.sort((a, b) => a.n.localeCompare(b.n, "pl"));
// Parametry odwzorowania — aplikacja przelicza nimi współrzędne geograficzne miast na punkty mapy
const proj = { k: projection.scale(), tx: projection.translate()[0], ty: projection.translate()[1] };
const millerJs = (lon, lat) => {
  const l = lon * Math.PI / 180, f = lat * Math.PI / 180;
  return [proj.tx + proj.k * l, proj.ty - proj.k * 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * f))];
};
for (const t of [[21, 52.2], [-74, 40.7], [151.2, -33.9]]) {
  const a = projection(t), b = millerJs(...t);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.01) throw new Error("Niezgodne odwzorowanie " + t);
}
fs.writeFileSync(new URL("world.json", OUT), JSON.stringify({ w: W, h: H, proj, sphere, graticule, countries }));

// --- Miasta
const isoToId = {};
for (const c of countries) if (c.iso && !isoToId[c.iso]) isoToId[c.iso] = c.id;
Object.assign(isoToId, { BQ: "NLD", CC: "AUS", CX: "AUS", GF: "FRA", GP: "FRA", MQ: "FRA", RE: "FRA",
  YT: "FRA", GI: "GBR", SJ: "NOR", TK: "NZL", AQ: "ATA" });

const plByGeonames = {};
for (const f of places.features) {
  const p = f.properties;
  if (p.GEONAMESID > 0 && p.NAME_PL && p.NAME_PL !== p.NAME) plByGeonames[p.GEONAMESID] = p.NAME_PL;
}

const byCountry = {};
let kept = 0;
const missing = new Set();
for (const c of cities) {
  if (!(c.population >= 5000 || /^PPLC|^PPLA$/.test(c.featureCode))) continue;
  const id = isoToId[c.country];
  if (!id) { missing.add(c.country); continue; }
  const [lon, lat] = c.loc.coordinates;
  const pl = plByGeonames[c.cityId] || "";
  (byCountry[id] ||= []).push([c.name, pl, +lon.toFixed(3), +lat.toFixed(3),
    c.population, c.featureCode === "PPLC" ? 1 : 0]);
  kept++;
}
for (const id in byCountry) byCountry[id].sort((a, b) => b[5] - a[5] || b[4] - a[4]);
// Spłaszczenie do zwartego formatu: "nazwa|pl|lon|lat|pop" rozdzielone \n
const compactCities = {};
for (const id in byCountry) compactCities[id] = byCountry[id].map((r) => r.slice(0, 5).join("|")).join("\n");
fs.writeFileSync(new URL("cities.json", OUT), JSON.stringify(compactCities));
console.log("miasta:", kept, "pominięte kody:", [...missing].join(" ") || "-");
for (const f of ["world.json", "cities.json"]) console.log(f, (fs.statSync(new URL(f, OUT)).size / 1024).toFixed(0), "KB");
