"""Reusable build: public PDF -> paper DXF + physical 1:1 DXF, with evidence.

Everything is driven by a mapping file, so the same code reproduces both outputs
for any page:

    {
      "source_pdf": "original.pdf", "page": 0,
      "anchors": [{"source_id": "...", "pair_id": "...", "label": "16mm",
                   "mm": 16.0, "direction": "x"}],
      "checks":  [{"source_id": "...", "pair_id": "...", "label": "14mm", "mm": 14.0}]
    }

Anchor/check distances are NOT typed by hand: they are read from the PDF arrow
candidates (`pdf_anchors`) by `pair_id`, in original PDF points, then converted to
paper millimetres. The mapping only states *which* pair means which dimension.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import math
from pathlib import Path

from .pdf_anchors import candidates
from .pdf_transcribe import (PT_TO_MM, audit_dxf, fit_scale, transcribe_page,
                             write_dxf)


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _vertices(dxf_path):
    import ezdxf

    doc = ezdxf.readfile(dxf_path)
    verts = []
    for e in doc.modelspace():
        if e.dxftype() == "LWPOLYLINE":
            verts += [(p[0], p[1]) for p in e.get_points("xy")]
        elif e.dxftype() == "HATCH":
            for path in e.paths:
                verts += [(v[0], v[1]) for v in path.vertices]
    return verts


def _measure(dxf_path, page_h_pt, k, items, by_pair):
    """Reopen the DXF and measure each anchor pair against its printed value."""
    verts = _vertices(dxf_path)
    out = []
    for it in items:
        pair = by_pair.get(it["pair_id"])
        if pair is None:
            out.append({"label": it["label"], "error": "pair_id not found in source candidates"})
            continue
        (x1, y1), (x2, y2) = pair["tips_pt"][0], pair["tips_pt"][1]
        p1 = (x1 * PT_TO_MM * k, (page_h_pt - y1) * PT_TO_MM * k)
        p2 = (x2 * PT_TO_MM * k, (page_h_pt - y2) * PT_TO_MM * k)
        near = lambda p: min(verts, key=lambda v: math.dist(v, p))
        v1, v2 = near(p1), near(p2)
        d = math.dist(v1, v2)
        out.append({
            "label": it["label"], "source_label_id": it.get("source_id"),
            "pair_id": it["pair_id"], "target_mm": it["mm"],
            "measured_mm": round(d, 4), "err_mm": round(d - it["mm"], 4),
            "tip_match_mm": round(max(math.dist(v1, p1), math.dist(v2, p2)), 6),
            "dxf_points": [[round(v1[0], 4), round(v1[1], 4)], [round(v2[0], 4), round(v2[1], 4)]],
        })
    return out


def _bbox_check(dxf_path, expect_w, expect_h, tol=0.05):
    import ezdxf

    doc = ezdxf.readfile(dxf_path)
    best = None
    for e in doc.modelspace():
        if e.dxftype() != "LWPOLYLINE" or not e.closed:
            continue
        pts = [(p[0], p[1]) for p in e.get_points("xy")]
        w = max(p[0] for p in pts) - min(p[0] for p in pts)
        h = max(p[1] for p in pts) - min(p[1] for p in pts)
        score = abs(w - expect_w) + abs(h - expect_h)
        if best is None or score < best[0]:
            best = (score, w, h)
    if best is None:
        return {"ok": False, "reason": "no closed polyline"}
    _, w, h = best
    return {"ok": abs(w - expect_w) <= tol and abs(h - expect_h) <= tol,
            "measured_w_mm": round(w, 3), "measured_h_mm": round(h, 3),
            "expect_w_mm": expect_w, "expect_h_mm": expect_h,
            "note": "在全部闭合折线中取包围盒最接近期望值的一条；源图轮廓由线段逼近，圆弧处存在逼近误差"}


def build(pdf, mapping_path, out_dir, paper_name="paper.dxf", physical_name="physical.dxf",
          render=True):
    mapping = json.load(open(mapping_path, encoding="utf-8"))
    pdf = str(pdf)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    page_no = mapping.get("page", 0)

    cand = candidates(pdf, page_no)
    by_pair = {p["id"]: p for p in cand["collinear_opposed_arrow_pairs"]}
    page_h_pt = None
    res = transcribe_page(pdf, page_no)
    page_h_pt = res["page_height_pt"]

    anchors = []
    for a in mapping["anchors"]:
        pair = by_pair[a["pair_id"]]
        anchors.append({"source_id": a["source_id"], "label": a["label"], "mm": a["mm"],
                        "measured_mm": pair["distance_pt"] * PT_TO_MM,
                        "direction": [1, 0] if pair["axis"] == "x" else [0, 1]})
    checks = []
    for c in mapping.get("checks", []):
        pair = by_pair[c["pair_id"]]
        checks.append({"source_id": c["source_id"], "label": c["label"], "mm": c["mm"],
                       "measured_mm": pair["distance_pt"] * PT_TO_MM})

    fit = fit_scale(anchors, checks)
    if not fit.get("fitted"):
        raise SystemExit(f"scale not fitted: {fit}")

    k = fit["mm_per_paper_mm"]
    paper = out_dir / paper_name
    physical = out_dir / physical_name
    paper_out = write_dxf(res, str(paper), scale=1.0)
    phys_out = write_dxf(res, str(physical), scale=k)
    paper_audit = audit_dxf(str(paper), paper_out["provenance"])
    phys_audit = audit_dxf(str(physical), phys_out["provenance"])

    for path, out in ((paper, paper_out), (physical, phys_out)):
        json.dump({"dxf": str(path), "sha256": out["sha256"], "scale": out["scale"],
                   "written": out["written"], "stats": res["stats"],
                   "provenance": out["provenance"]},
                  open(str(path).replace(".dxf", "-provenance.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2,
                  default=lambda o: o.item() if hasattr(o, "item") else str(o))

    if render:
        from .engine import render as render_dxf
        for path in (paper, physical):
            try:
                render_dxf(path)
            except Exception:  # noqa: BLE001 - rendering must not fail the build
                pass

    record = {
        "built_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_pdf": pdf, "pdf_sha256": _sha(pdf), "page": page_no,
        "page_rect_pt": res["rect"], "stats": res["stats"],
        "paper": {"dxf": str(paper), "sha256": paper_out["sha256"],
                  "written": paper_out["written"], "audit": paper_audit},
        "physical": {"dxf": str(physical), "sha256": phys_out["sha256"],
                     "written": phys_out["written"], "audit": phys_audit},
        "fit": fit,
        "reopen_measurement": _measure(str(physical), page_h_pt, k,
                                       mapping["anchors"] + mapping.get("checks", []), by_pair),
    }
    if mapping.get("bbox_check"):
        b = mapping["bbox_check"]
        record["bbox_check"] = _bbox_check(str(physical), b["w"], b["h"])
    json.dump(record, open(out_dir / "build-record.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2,
                  default=lambda o: o.item() if hasattr(o, "item") else str(o))
    return record


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 4:
        print("usage: python -m cad_harness.vector_build <pdf> <mapping.json> <out_dir>")
        raise SystemExit(2)
    rec = build(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps({k: rec[k] for k in ("paper", "physical", "fit")},
                     ensure_ascii=False, indent=2,
                  default=lambda o: o.item() if hasattr(o, "item") else str(o))[:2000])
