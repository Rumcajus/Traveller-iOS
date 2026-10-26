"""Pobiera z Overture Maps (dane OpenStreetMap) ulice, wodę i zieleń dla prostokąta wokół Warszawy.

Czyta tylko potrzebne fragmenty plików Parquet (zapytania HTTP Range), bez pobierania całych plików.
Użycie: python3 overture_fetch.py  → tools/raw/overture/*.parquet
"""
import io, os, re, sys, concurrent.futures as cf
import requests, pyarrow as pa, pyarrow.parquet as pq

BASE = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
RELEASE = "release/2026-10-21.0"
BBOX = (20.84, 52.09, 21.28, 52.37)  # lon_min, lat_min, lon_max, lat_max
OUT = os.path.join(os.path.dirname(__file__), "raw", "overture")
S = requests.Session()
S.verify = os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"


class HttpFile(io.RawIOBase):
    """Plik tylko do odczytu oparty na zapytaniach HTTP Range (z buforem bloków)."""
    def __init__(self, url, size):
        self.url, self.size, self.pos, self.cache = url, size, 0, {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        end = min(self.size, self.pos + n)
        if end <= self.pos: return b""
        r = S.get(self.url, headers={"Range": f"bytes={self.pos}-{end - 1}"}, timeout=120)
        r.raise_for_status()
        data = r.content
        self.pos += len(data)
        return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def list_files(prefix):
    keys, token = [], None
    while True:
        url = f"{BASE}/?list-type=2&prefix={RELEASE}/{prefix}/" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
        x = S.get(url, timeout=60).text
        keys += [(k, int(s)) for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", x)]
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", x)
        if not m: return keys
        token = m.group(1)


def stat_range(md, rg, name):
    col = md.row_group(rg)
    for i in range(col.num_columns):
        c = col.column(i)
        if c.path_in_schema == name and c.statistics and c.statistics.has_min_max:
            return c.statistics.min, c.statistics.max
    return None


def matching_groups(key, size):
    f = HttpFile(f"{BASE}/{key}", size)
    pf = pq.ParquetFile(f)
    md = pf.metadata
    groups = []
    for rg in range(md.num_row_groups):
        xmin = stat_range(md, rg, "bbox.xmin"); xmax = stat_range(md, rg, "bbox.xmax")
        ymin = stat_range(md, rg, "bbox.ymin"); ymax = stat_range(md, rg, "bbox.ymax")
        if not all((xmin, xmax, ymin, ymax)): continue
        if xmin[0] > BBOX[2] or xmax[1] < BBOX[0] or ymin[0] > BBOX[3] or ymax[1] < BBOX[1]: continue
        groups.append(rg)
    return key, size, groups


def fetch(theme, columns, name):
    files = list_files(theme)
    print(theme, "plików:", len(files), file=sys.stderr)
    with cf.ThreadPoolExecutor(16) as ex:
        found = [r for r in ex.map(lambda ks: matching_groups(*ks), files) if r[2]]
    print("  pasujące pliki/grupy:", [(k.split("/")[-1][:14], g) for k, _, g in found], file=sys.stderr)
    tables = []
    for key, size, groups in found:
        pf = pq.ParquetFile(HttpFile(f"{BASE}/{key}", size))
        for rg in groups:
            t = pf.read_row_group(rg, columns=columns)
            b = t.column("bbox").combine_chunks()
            xmin, xmax = b.field("xmin").to_numpy(), b.field("xmax").to_numpy()
            ymin, ymax = b.field("ymin").to_numpy(), b.field("ymax").to_numpy()
            mask = (xmax >= BBOX[0]) & (xmin <= BBOX[2]) & (ymax >= BBOX[1]) & (ymin <= BBOX[3])
            tables.append(t.filter(pa.array(mask)))
    t = pa.concat_tables(tables)
    os.makedirs(OUT, exist_ok=True)
    pq.write_table(t, os.path.join(OUT, name + ".parquet"))
    print("  zapisano", name, t.num_rows, "obiektów", file=sys.stderr)


if __name__ == "__main__":
    fetch("theme=transportation/type=segment", ["id", "bbox", "geometry", "subtype", "class", "names"], "segments")
    fetch("theme=base/type=water", ["id", "bbox", "geometry", "subtype", "class", "names"], "water")
    fetch("theme=base/type=land_use", ["id", "bbox", "geometry", "subtype", "class"], "land_use")
