"""Batch wrapper around vector_build: auto anchor mapping, functional view, coverage.

Nothing here types a dimension by hand. `auto_mapping` derives which arrow pair
means which printed millimetre value from the PDF alone, and refuses when the
assignment is not consistent within the tolerance.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .pdf_anchors import candidates
from .pdf_transcribe import PT_TO_MM
from .vector_build import build


def auto_mapping(pdf, page=0, tol=0.01):
    import re

    cand = candidates(pdf, page)
    pairs = cand["collinear_opposed_arrow_pairs"]
    labels, seen = [], set()
    for l in cand["explicit_mm_labels"]:
        # A title such as "Optic Mount, 50.0mm Optic Diameter" contains a number
        # followed by mm; it is not a dimension label. Keep only spans that *start*
        # with the value.
        if not re.match(r"^\s*\d+(?:\.\d+)?\s*mm\b", l["text"], re.I):
            continue
        key = round(l["value_mm"], 6)
        if key in seen:
            continue
        seen.add(key)
        labels.append(l)
    if len(pairs) < 2 or len(labels) < 2:
        return None

    best = None
    for p0 in pairs:
        for l0 in labels:
            s0 = l0["value_mm"] / (p0["distance_pt"] * PT_TO_MM)
            inliers = sum(
                1 for p in pairs
                if any(abs(l["value_mm"] - p["distance_pt"] * PT_TO_MM * s0) <= tol * l["value_mm"]
                       for l in labels))
            if best is None or inliers > best[0]:
                best = (inliers, s0)
    _, s0 = best

    def assign(scale):
        out, used = [], set()
        for p in sorted(pairs, key=lambda q: q["distance_pt"]):
            d = p["distance_pt"] * PT_TO_MM
            options = [(abs(l["value_mm"] - d * scale) / l["value_mm"], l) for l in labels
                       if l["id"] not in used]
            if not options:
                continue
            err, lab = min(options, key=lambda t: t[0])
            if err > tol:
                continue
            used.add(lab["id"])
            out.append({"source_id": lab["id"], "pair_id": p["id"], "label": lab["text"],
                        "mm": lab["value_mm"], "axis": p["axis"],
                        "rel_residual": round(err, 6)})
        return out

    # Two refit rounds: labels without their own arrow pair get dropped instead of
    # being force-matched to a neighbouring one.
    assignments = assign(s0)
    for _ in range(2):
        if not assignments:
            break
        ratios = sorted(a["mm"] / next(
            p["distance_pt"] * PT_TO_MM for p in pairs if p["id"] == a["pair_id"])
            for a in assignments)
        scale = ratios[len(ratios) // 2]
        assignments = assign(scale)

    if len({a["axis"] for a in assignments}) < 2:
        return None
    anchors, checks = [], []
    for axis in ("x", "y"):
        ranked = sorted([a for a in assignments if a["axis"] == axis],
                        key=lambda a: a["rel_residual"])
        if ranked:
            anchors.append(ranked[0])
            checks.extend(ranked[1:])
    checks.extend([a for a in assignments if a not in anchors and a not in checks])
    return {"source_pdf": str(pdf), "page": page, "anchors": anchors, "checks": checks,
            "auto_scale_hint": s0, "dropped_labels_without_pairs": True}


def write_functional(path, modules=("support", "aperture", "axial limit", "mount interface")):
    import ezdxf

    doc = ezdxf.new("R2010")
    doc.units = 4
    msp = doc.modelspace()
    n = len(modules)
    w, gap = 18.0, 4.0
    total = n * w + (n - 1) * gap
    msp.add_lwpolyline([(-4, -4), (total + 4, -4), (total + 4, 18), (-4, 18)],
                       close=True, dxfattribs={"layer": "FUNC_SYSTEM"})
    for i in range(n):
        x0 = i * (w + gap)
        msp.add_lwpolyline([(x0, 0), (x0 + w, 0), (x0 + w, 12), (x0, 12)],
                           close=True, dxfattribs={"layer": "FUNC_MODULE"})
        if i:
            msp.add_line(((i - 1) * (w + gap) + w, 6), (x0, 6),
                         dxfattribs={"layer": "FUNC_LINK"})
        msp.add_text(modules[i], dxfattribs={"layer": "FUNC_LABEL", "height": 2.0,
                                             "insert": (x0 + 1.0, 5.0)})
    doc.saveas(path)
    return path


def coverage(record, case_dir):
    """Compare what the PDF contains with what the DXF carries."""
    stats = record["stats"]
    written = record["paper"]["written"]
    src_drawings = stats.get("polyline", 0) + stats.get("hatch", 0) + stats.get("spline", 0)
    out_ents = written.get("polyline", 0) + written.get("hatch", 0) + written.get("spline", 0)
    return {
        "source_path_items_to_dxf": {"source_drawings": src_drawings, "dxf_entities": out_ents,
                                     "failed": written.get("failed", 0)},
        "text": {"source_spans": stats.get("text", 0), "dxf_text": written.get("text", 0)},
        "hatch": {"source_rings": stats.get("rings", 0), "dxf_hatches": written.get("hatch", 0)},
        "bookkeeping_ok": written.get("failed", 0) == 0
                          and stats.get("text", 0) == written.get("text", 0),
    }


def run_case(case_dir, paper_name="first-pass-paper.dxf",
             physical_name="first-pass-physical.dxf", functional_name="functional.dxf"):
    case_dir = Path(case_dir)
    pdf = case_dir / "original.pdf"
    mapping = auto_mapping(str(pdf))
    if mapping is None:
        return {"case": case_dir.name, "status": "BLOCKED",
                "reason": "auto anchor mapping found no consistent scale with two axes"}
    map_path = case_dir / "anchors.json"
    json.dump(mapping, map_path.open("w", encoding="utf-8"), ensure_ascii=False, indent=2)
    rec = build(str(pdf), str(map_path), str(case_dir),
                paper_name=paper_name, physical_name=physical_name)
    write_functional(str(case_dir / functional_name))
    rec["coverage"] = coverage(rec, str(case_dir))
    rec["case"] = case_dir.name
    rec["mapping"] = str(map_path)
    json.dump(rec, (case_dir / "build-record.json").open("w", encoding="utf-8"),
              ensure_ascii=False, indent=2,
              default=lambda o: o.item() if hasattr(o, "item") else str(o))
    return rec
