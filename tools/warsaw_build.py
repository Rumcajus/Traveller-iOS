"""Buduje szczegółową warstwę Warszawy (ulice, woda, zieleń w granicach miasta) → data/warsaw.json.

Wejście: tools/raw/overture/*.parquet (z overture_fetch.py) i data/world.json (parametry odwzorowania).
Współrzędne są w odwzorowaniu mapy, liczone od rogu prostokąta, w jednostkach 1e-4 mapy (ok. 1–3 m).
"""
import json, math, os
import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely.geometry import box, LineString, MultiLineString, Polygon, MultiPolygon
from shapely.ops import linemerge, unary_union

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "raw", "overture")
OUT = os.path.join(HERE, "..", "data", "warsaw.json")
BBOX = (20.84, 52.09, 21.28, 52.37)
UNIT = 1e-4

proj = json.load(open(os.path.join(HERE, "..", "data", "world.json")))["proj"]
RAD = math.pi / 180


def miller(lon, lat):
    return proj["tx"] + proj["k"] * lon * RAD, proj["ty"] - proj["k"] * 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * lat * RAD))


X0, Y1 = miller(BBOX[0], BBOX[1])
X1, Y0 = miller(BBOX[2], BBOX[3])


def to_local(geom):
    def f(xy):
        px = proj["tx"] + proj["k"] * xy[:, 0] * RAD
        py = proj["ty"] - proj["k"] * 1.25 * np.log(np.tan(np.pi / 4 + 0.4 * xy[:, 1] * RAD))
        return np.column_stack([(px - X0) / UNIT, (py - Y0) / UNIT])
    return shapely.transform(geom, f)


# Przycinamy do granicy administracyjnej Warszawy (Overture divisions), a nie do prostokąta
_div = pq.read_table(os.path.join(RAW, "division_area.parquet")).to_pandas()
_div = _div[(_div["subtype"] == "locality") & _div["names"].map(lambda n: (n or {}).get("primary") == "Warszawa")]
CLIP = shapely.from_wkb(_div["geometry"].iloc[0]) if len(_div) else box(*BBOX)


def load(name):
    t = pq.read_table(os.path.join(RAW, name + ".parquet")).to_pandas()
    t["geom"] = shapely.from_wkb(t["geometry"].values)
    t["geom"] = shapely.intersection(t["geom"].values, CLIP)
    return t[~shapely.is_empty(t["geom"].values)]


def enc_line(coords):
    pts = [(round(x), round(y)) for x, y in coords]
    out, px, py = [], None, None
    for x, y in pts:
        if px is None:
            out.append(f"M{x} {y}")
        elif (x, y) != (px, py):
            out.append(f"{x - px} {y - py}")
        px, py = x, y
    if len(out) < 2:
        return ""
    return out[0] + "l" + " ".join(out[1:]).replace(" -", "-")


def enc_poly(geom):
    parts = []
    for p in getattr(geom, "geoms", [geom]):
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            s = enc_line(list(ring.coords)[:-1])
            if s:
                parts.append(s + "z")
    return "".join(parts)


def polys(geoms, tol):
    g = unary_union([x for x in geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    g = to_local(g).simplify(tol, preserve_topology=True)
    g = g.buffer(0)
    # pomijamy drobiazgi mniejsze niż ok. 15×15 m
    keep = [p for p in getattr(g, "geoms", [g]) if p.area > 60]
    return enc_poly(MultiPolygon(keep) if keep else Polygon())


def lines(geom):
    return [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, LineString)]


# --- woda
w = load("water")
water_poly = polys(w[w["subtype"].isin(["river", "lake", "pond", "reservoir", "water", "canal"]) & (w["class"] != "swimming_pool")]["geom"], 3)
wl = w[w["class"].isin(["river", "canal", "stream"])]
water_lines = "".join(enc_line(l.coords) for g in wl["geom"] for l in lines(to_local(g).simplify(2)))

# --- zieleń
lu = load("land_use")
ld = load("land")
green = polys(list(lu[lu["class"].isin(["park", "cemetery", "grave_yard", "allotments", "recreation_ground", "garden"]) & (lu["subtype"] != "horticulture") | lu["class"].isin(["allotments"])]["geom"])
              + list(ld[ld["class"].isin(["forest", "wood"])]["geom"]), 3)

# --- ulice i tory
s = load("segments")
CLASSES = {
    "motorway": 0, "trunk": 0, "primary": 0,
    "secondary": 1, "tertiary": 1,
    "residential": 2, "living_street": 2, "unclassified": 2, "pedestrian": 2,
}
s["name"] = s["names"].map(lambda n: (n or {}).get("primary") or "")
roads = s[(s["subtype"] == "road") & s["class"].isin(CLASSES.keys())].copy()
roads["c"] = roads["class"].map(CLASSES)

names, name_idx = [], {}
out_roads = []
CHUNK = 900  # ok. 1 km — długie ulice dzielimy, żeby nazwy mogły pojawić się w kilku miejscach
for (c, name), grp in roads.groupby(["c", "name"]):
    merged = linemerge([l for g in grp["geom"] for l in lines(g)])
    for ln in lines(merged):
        ln = to_local(ln).simplify(1.2 if c < 2 else 1.6)
        coords = list(ln.coords)
        if len(coords) < 2:
            continue
        # podział na kawałki ~CHUNK jednostek
        pieces, cur, acc = [], [coords[0]], 0
        for a, b in zip(coords, coords[1:]):
            acc += math.dist(a, b)
            cur.append(b)
            if acc >= CHUNK:
                pieces.append(cur); cur = [b]; acc = 0
        if len(cur) > 1:
            pieces.append(cur)
        for pc in pieces:
            if pc[-1][0] < pc[0][0]:
                pc = pc[::-1]  # napis ma iść od lewej do prawej, nie do góry nogami
            d = enc_line(pc)
            if not d:
                continue
            if name and name not in name_idx:
                name_idx[name] = len(names); names.append(name)
            xs, ys = [p[0] for p in pc], [p[1] for p in pc]
            length = sum(math.dist(a, b) for a, b in zip(pc, pc[1:]))
            out_roads.append([c, name_idx[name] if name else -1, d, round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)), round(length)])

rail = s[(s["subtype"] == "rail") & (s["class"] == "standard_gauge")]
rail_d = "".join(enc_line(l.coords) for l in lines(to_local(linemerge([l for g in rail["geom"] for l in lines(g)])).simplify(2)))

data = {
    "x0": X0, "y0": Y0, "unit": UNIT, "w": round((X1 - X0) / UNIT), "h": round((Y1 - Y0) / UNIT),
    "water": water_poly, "waterLines": water_lines, "green": green, "rail": rail_d,
    "names": names, "roads": out_roads,
}
json.dump(data, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print("ulice:", len(out_roads), "nazw:", len(names), "rozmiar:", os.path.getsize(OUT) // 1024, "KB",
      "| woda", len(water_poly) // 1024, "KB, zieleń", len(green) // 1024, "KB, tory", len(rail_d) // 1024, "KB")
