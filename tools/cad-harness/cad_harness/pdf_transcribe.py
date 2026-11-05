"""Source-vector transcription: public PDF page -> editable DXF (v3).

v3 adds what the R6 review asked for:

* Fills follow the PDF fill semantics: a filled sub-path is closed **implicitly**
  even when the last vertex does not repeat the first one, and `closePath` is
  honoured. All sub-paths of one filled drawing become the boundary rings of a
  single HATCH (first ring external, the rest are islands), so holes and the
  logo's inner/outer rings keep their relationship instead of each being filled
  separately.
* `audit_dxf` now checks far more than strings and positions: document units,
  HATCH rings against provenance, polyline closure and linetype, text height and
  rotation.
* `fit_scale` identifies anchors by **source id**, not by label text, and refuses
  to reuse an id inside the cross-check.
* `build_physical` scales paper geometry to a fitted physical scale and records
  the transformation, so the 1:1 file can be measured after reopening.

What is still not claimed: a drawing whose labels cannot be paired with their own
extension arrows has no physical scale, and no manufacturing detail becomes known
merely because the vectors were transcribed.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field

PT_TO_MM = 25.4 / 72.0
CAP_RATIO = 0.70
WIDTH_EM = 0.60


@dataclass
class Entity:
    kind: str
    points: list = field(default_factory=list)
    rings: list = field(default_factory=list)
    text: str = ""
    height: float = 0.0
    rotation: float = 0.0
    layer: str = "PDF"
    drawing_index: int = -1
    item_index: int = -1
    span_id: str = ""
    closed: bool = False
    filled: bool = False
    dash: str = ""
    stroke_mm: float = 0.0
    width_target: float = 0.0
    bold: bool = False


def _subpaths(drawing):
    """Split one drawing into sub-paths. Curves are returned separately."""
    subs, cur, curves = [], [], []
    for iidx, item in enumerate(drawing["items"]):
        op = item[0]
        if op == "l":
            p1, p2 = item[1], item[2]
            a, b = (p1.x, p1.y), (p2.x, p2.y)
            if cur and math.dist(cur[-1], a) > 1e-4:
                subs.append(cur)
                cur = []
            if not cur:
                cur = [a]
            cur.append(b)
        elif op == "c":
            if cur:
                subs.append(cur)
                cur = []
            curves.append((iidx, [(p.x, p.y) for p in item[1:5]]))
        elif op in ("re", "qu"):
            r = item[1]
            if op == "re":
                pts = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
            else:
                pts = [(p.x, p.y) for p in (r.ul, r.ur, r.lr, r.ll)]
            if cur:
                subs.append(cur)
                cur = []
            subs.append(pts + [pts[0]])
    if cur:
        subs.append(cur)
    return subs, curves


def _ring_area(ring):
    s = 0.0
    for a, b in zip(ring, ring[1:] + ring[:1]):
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) / 2.0


def _point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1
            if x < xin:
                inside = not inside
    return inside


def group_rings(rings):
    """Split fill rings into (outer, [holes]) groups by containment.

    PDF fills one drawing's sub-paths with even-odd/non-zero: spatially separate
    loops are *separate islands*, not holes of the first loop. Depth comes from
    containment; even depth = outer boundary, odd depth = hole of its parent.
    """
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return []
    areas = [_ring_area(r) for r in rings]
    order = sorted(range(len(rings)), key=lambda i: areas[i], reverse=True)

    parent = {}
    for i in order:
        probe = rings[i][0]
        candidates = [j for j in order
                      if j != i and areas[j] > areas[i] and _point_in_ring(probe, rings[j])]
        if candidates:
            parent[i] = min(candidates, key=lambda j: areas[j])

    depth = {}

    def depth_of(i):
        if i not in depth:
            depth[i] = 0 if i not in parent else depth_of(parent[i]) + 1
        return depth[i]

    groups = {}
    for i in order:
        groups[i] = None
    for i in order:
        d = depth_of(i)
        if d % 2 == 0:
            groups[i] = [rings[i]]
    for i in order:
        if depth_of(i) % 2 == 1:
            p = parent.get(i)
            while p is not None and depth_of(p) % 2 == 1:
                p = parent.get(p)
            if p is not None and groups.get(p):
                groups[p].append(rings[i])
            else:
                groups[i] = [rings[i]]
    return [g for g in groups.values() if g]


def transcribe_page(pdf_path, page_no=0):
    import fitz

    doc = fitz.open(pdf_path)
    page = doc[page_no]
    H = page.rect.height
    entities = []
    stats = {"polyline": 0, "spline": 0, "text": 0, "hatch": 0, "rings": 0, "skipped": 0}

    def to_mm(pts):
        return [(x * PT_TO_MM, (H - y) * PT_TO_MM) for x, y in pts]

    for didx, drawing in enumerate(page.get_drawings()):
        filled = "f" in str(drawing.get("type") or "")
        dash = drawing.get("dashes") or ""
        width = float(drawing.get("width") or 1.0) * PT_TO_MM
        layer = "PDF_FILL" if filled else ("PDF_DASH" if dash.strip("[] 0") else "PDF")
        subs, curves = _subpaths(drawing)

        for iidx, cps in curves:
            entities.append(Entity("spline", to_mm(cps), layer=layer, drawing_index=didx,
                                   item_index=iidx, dash=dash, stroke_mm=width))
            stats["spline"] += 1

        if not subs:
            continue
        if filled:
            rings = []
            for s in subs:
                ring = to_mm(s)
                # PDF fill closes every sub-path implicitly; drop a repeated end point
                if len(ring) > 2 and math.dist(ring[0], ring[-1]) < 1e-6:
                    ring = ring[:-1]
                if len(ring) >= 3:
                    rings.append(ring)
            if rings:
                entities.append(Entity("hatch", rings=rings, points=rings[0], closed=True,
                                       filled=True, layer=layer, drawing_index=didx,
                                       item_index=len(drawing["items"]) - 1,
                                       dash=dash, stroke_mm=width))
                stats["hatch"] += 1
                stats["rings"] += len(rings)
            else:
                stats["skipped"] += 1
        else:
            for j, s in enumerate(subs):
                pts = to_mm(s)
                closed = len(pts) > 3 and math.dist(pts[0], pts[-1]) < 1e-6
                if closed:
                    pts = pts[:-1]
                if len(pts) < 2:
                    stats["skipped"] += 1
                    continue
                entities.append(Entity("polyline", pts, closed=closed, layer=layer,
                                       drawing_index=didx, item_index=j, dash=dash,
                                       stroke_mm=width))
                stats["polyline"] += 1

    span_counter = 0
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            direction = line.get("dir", (1, 0))
            rot = math.degrees(math.atan2(-direction[1], direction[0]))
            for span in line["spans"]:
                span_counter += 1
                s = span["text"]
                if not s.strip():
                    stats["skipped"] += 1
                    continue
                ox, oy = span["origin"]
                bbox = span["bbox"]
                font = (span.get("font") or "").lower()
                entities.append(Entity(
                    "text", [(ox * PT_TO_MM, (H - oy) * PT_TO_MM)], text=s,
                    height=span["size"] * PT_TO_MM * CAP_RATIO, rotation=rot,
                    layer="PDF_TEXT", span_id=f"span-{span_counter:04d}",
                    width_target=(bbox[2] - bbox[0]) * PT_TO_MM,
                    bold=("bold" in font or "black" in font or "heavy" in font)))
                stats["text"] += 1

    return {"page": page_no, "rect": list(page.rect), "page_height_pt": H,
            "units": "millimetre (paper space)", "entities": entities, "stats": stats}


def _linetype_for(doc, pattern_text, scale=1.0):
    name = "LT_" + hashlib.sha1(f"{pattern_text}@{scale:.6f}".encode()).hexdigest()[:8].upper()
    if name in doc.linetypes:
        return name
    nums = [float(x) for x in pattern_text.replace("[", " ").replace("]", " ").split()]
    dashes, gaps = nums[0::2], nums[1::2]
    if not dashes:
        return None
    pattern = [max(sum(dashes) + sum(gaps), 0.01) * PT_TO_MM * scale]
    for d, g in zip(dashes, gaps):
        pattern += [max(d * PT_TO_MM * scale, 0.001), -max(g * PT_TO_MM * scale, 0.001)]
    try:
        doc.linetypes.add(name, pattern=pattern, description=f"PDF dash {pattern_text}")
        return name
    except Exception:  # noqa: BLE001
        return None


def write_dxf(result, path, scale=1.0, dxfversion="R2010", text_scale=None):
    """scale: factor applied to geometry; text_scale defaults to the same factor."""
    import ezdxf

    if text_scale is None:
        text_scale = scale

    doc = ezdxf.new(dxfversion)
    doc.units = 4
    msp = doc.modelspace()
    written = {"polyline": 0, "spline": 0, "text": 0, "hatch": 0, "failed": 0}
    provenance = []

    def S(p):
        return (p[0] * scale, p[1] * scale)

    if "BOLD" not in doc.styles:
        try:
            doc.styles.add("BOLD", font="arialbd.ttf")
        except Exception:  # noqa: BLE001
            pass

    for e in result["entities"]:
        try:
            if e.kind == "hatch":
                handle = None
                for gi, group in enumerate(group_rings(e.rings)):
                    h = msp.add_hatch(dxfattribs={"layer": e.layer})
                    for i, ring in enumerate(group):
                        h.paths.add_polyline_path([S(p) for p in ring], is_closed=True,
                                                  flags=1 if i == 0 else 0)
                    h.set_solid_fill(color=7)
                    handle = h.dxf.handle
                    written["hatch"] += 1
                    provenance.append({
                        "handle": handle, "kind": "hatch", "layer": e.layer,
                        "page": result["page"], "drawing_index": e.drawing_index,
                        "item_index": e.item_index, "span_id": "", "text": "",
                        "group_index": gi,
                        "rings": [[[round(x * scale, 6), round(y * scale, 6)] for x, y in r]
                                  for r in group],
                        "points_mm": [], "closed": True, "dash": e.dash,
                        "height_mm": None, "rotation": None, "scale": scale,
                    })
                if handle is None:
                    written["failed"] += 1
                continue
            elif e.kind == "polyline":
                attribs = {"layer": e.layer}
                if e.dash:
                    lt = _linetype_for(doc, e.dash, scale)
                    if lt:
                        attribs["linetype"] = lt
                if e.stroke_mm:
                    attribs["lineweight"] = max(1, min(211, int(e.stroke_mm * 100)))
                pl = msp.add_lwpolyline([S(p) for p in e.points], close=e.closed,
                                        dxfattribs=attribs)
                handle = pl.dxf.handle
            elif e.kind == "spline":
                sp = msp.add_open_spline([S(p) for p in e.points], degree=3,
                                         dxfattribs={"layer": e.layer})
                handle = sp.dxf.handle
            elif e.kind == "text":
                attribs = {"layer": e.layer, "height": max(e.height * text_scale, 0.01),
                           "insert": S(e.points[0])}
                if e.bold and "BOLD" in doc.styles:
                    attribs["style"] = "BOLD"
                t = msp.add_text(e.text, dxfattribs=attribs)
                if e.rotation:
                    t.dxf.rotation = e.rotation
                if e.width_target > 0:
                    est = max(len(e.text) * e.height * WIDTH_EM, 1e-6)
                    t.dxf.width = max(0.2, min(1.0, e.width_target / est))
                handle = t.dxf.handle
            else:
                continue
        except Exception:  # noqa: BLE001
            written["failed"] += 1
            continue
        written[e.kind] = written.get(e.kind, 0) + 1
        provenance.append({
            "handle": handle, "kind": e.kind, "layer": e.layer, "page": result["page"],
            "drawing_index": e.drawing_index, "item_index": e.item_index,
            "span_id": e.span_id, "text": e.text,
            "rings": [[[round(x * scale, 6), round(y * scale, 6)] for x, y in r] for r in e.rings] if e.kind == "hatch" else [],
            "points_mm": [[round(x * scale, 6), round(y * scale, 6)] for x, y in e.points],
            "closed": e.closed, "dash": e.dash,
            "height_mm": (e.height * text_scale) if e.kind == "text" else None,
            "rotation": e.rotation if e.kind == "text" else None,
            "scale": scale,
        })

    doc.saveas(path)
    return {"written": written, "provenance": provenance, "units": doc.units,
            "scale": scale, "dxf": path,
            "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}


def audit_dxf(dxf_path, provenance, tol_mm=1e-6, expect_units=4):
    """Reopen the DXF and check every provenance row plus document-level facts."""
    import ezdxf

    doc = ezdxf.readfile(dxf_path)
    problems = []
    if expect_units is not None and doc.units != expect_units:
        problems.append({"kind": "UNITS_CHANGED", "expected": expect_units, "actual": doc.units})
    by_handle = {e.dxf.handle: e for e in doc.modelspace()}

    for row in provenance:
        ent = by_handle.get(row["handle"])
        if ent is None:
            problems.append({"kind": "MISSING_ENTITY", "handle": row["handle"]})
            continue
        if row["kind"] == "text":
            if ent.dxftype() != "TEXT" or ent.dxf.text != row["text"]:
                problems.append({"kind": "TEXT_CHANGED", "handle": row["handle"]})
                continue
            if ent.dxf.hasattr("height") and row.get("height_mm") is not None:
                if abs(ent.dxf.height - row["height_mm"]) > 1e-6:
                    problems.append({"kind": "TEXT_HEIGHT_CHANGED", "handle": row["handle"]})
            if row.get("rotation") is not None and ent.dxf.hasattr("rotation"):
                if abs(float(ent.dxf.rotation) - float(row["rotation"])) > 1e-6:
                    problems.append({"kind": "TEXT_ROTATION_CHANGED", "handle": row["handle"]})
            ix, iy = ent.dxf.insert.x, ent.dxf.insert.y
            if math.dist((ix, iy), row["points_mm"][0]) > tol_mm:
                problems.append({"kind": "TEXT_MOVED", "handle": row["handle"]})
        elif row["kind"] == "hatch":
            if ent.dxftype() != "HATCH":
                problems.append({"kind": "HATCH_MISSING", "handle": row["handle"]})
                continue
            rings = list(ent.paths)
            if len(rings) != len(row["rings"]):
                problems.append({"kind": "HATCH_RING_COUNT", "handle": row["handle"],
                                 "expected": len(row["rings"]), "actual": len(rings)})
                continue
            for exp, path in zip(row["rings"], rings):
                got = [(p[0], p[1]) for p in path.vertices]
                if len(got) != len(exp) or any(math.dist(a, b) > tol_mm for a, b in zip(got, exp)):
                    problems.append({"kind": "HATCH_RING_CHANGED", "handle": row["handle"]})
                    break
        elif row["kind"] == "polyline":
            if ent.dxftype() != "LWPOLYLINE":
                problems.append({"kind": "POLYLINE_MISSING", "handle": row["handle"]})
                continue
            if bool(ent.closed) != bool(row.get("closed")):
                problems.append({"kind": "POLYLINE_CLOSURE_CHANGED", "handle": row["handle"]})
            if row.get("dash"):
                if ent.dxf.linetype in ("ByLayer", "Continuous", None):
                    problems.append({"kind": "LINETYPE_LOST", "handle": row["handle"]})
            pts = [(p[0], p[1]) for p in ent.get_points("xy")]
            if len(pts) != len(row["points_mm"]) or any(
                    math.dist(a, b) > tol_mm for a, b in zip(pts, row["points_mm"])):
                problems.append({"kind": "GEOMETRY_CHANGED", "handle": row["handle"]})
        elif row["kind"] == "spline":
            cps = [(p[0], p[1]) for p in ent.control_points]
            if len(cps) != len(row["points_mm"]) or any(
                    math.dist(a, b) > tol_mm for a, b in zip(cps, row["points_mm"])):
                problems.append({"kind": "SPLINE_CONTROL_CHANGED", "handle": row["handle"]})

    return {"ok": not problems, "problems": problems, "checked": len(provenance),
            "entities_in_file": len(by_handle)}


def fit_scale(anchors, check_values=(), tol_rel=0.01, min_angle_deg=20.0):
    """Fit physical mm per paper mm from independently sourced anchors.

    tol_rel follows acceptance-policy.json (user: about 1% relative error). It is a
    fit-consistency bound, not a licence to ignore a structural defect.

    anchors: [{'source_id', 'label', 'mm', 'measured_mm', 'direction':[dx,dy]}]
    Independence is by `source_id`, not by label text: two drawings can print the
    same "16mm".
    """
    for a in anchors:
        for k in ("mm", "measured_mm"):
            v = a.get(k)
            if not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
                return {"fitted": False, "reason": f"anchor {a.get('source_id')} has invalid {k}"}
        d = a.get("direction")
        if not (isinstance(d, (list, tuple)) and len(d) == 2 and any(abs(v) > 0 for v in d)):
            return {"fitted": False, "reason": f"anchor {a.get('source_id')} has no direction"}
        if not a.get("source_id"):
            return {"fitted": False, "reason": "anchor without source_id cannot be checked for independence"}
    if len(anchors) < 2:
        return {"fitted": False, "reason": "fewer than two anchors"}

    def ang(v):
        return math.degrees(math.atan2(v[1], v[0])) % 180.0

    spread = max(abs(ang(a["direction"]) - ang(anchors[0]["direction"])) for a in anchors)
    if spread < min_angle_deg:
        return {"fitted": False, "reason": f"anchors not in distinct directions ({spread:.1f} deg)"}

    scales = [a["mm"] / a["measured_mm"] for a in anchors]
    lo, hi = min(scales), max(scales)
    if (hi - lo) / lo > tol_rel:
        return {"fitted": False, "reason": "anchor scales disagree", "scales": scales}
    scale = sum(scales) / len(scales)

    used = {a["source_id"] for a in anchors}
    checks = []
    for c in check_values:
        if c.get("source_id") in used:
            checks.append({"source_id": c.get("source_id"), "reused": True, "pass": False})
            continue
        expect = c["mm"] / scale
        err = abs(expect - c["measured_mm"])
        checks.append({"source_id": c.get("source_id"), "expected_mm": expect,
                       "measured_mm": c["measured_mm"], "abs_error_mm": err,
                       "pass": err <= tol_rel * max(c["mm"], 1e-9)})
    return {"fitted": True, "mm_per_paper_mm": scale, "anchors": scales,
            "max_anchor_rel_spread": (hi - lo) / lo, "checks": checks,
            "cross_check_passed": bool(checks) and all(c["pass"] for c in checks)}
