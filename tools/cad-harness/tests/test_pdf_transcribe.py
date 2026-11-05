"""Tests for source-vector transcription v3 (fills, audit breadth, scale fit)."""
import math
import os
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [
    os.path.dirname(_HERE),
]

try:
    import fitz
    HAS_FITZ = True
except Exception:  # noqa: BLE001
    HAS_FITZ = False

try:
    import ezdxf
    from ezdxf.math import BSpline
    HAS_EZDXF = True
except Exception:  # noqa: BLE001
    HAS_EZDXF = False

from cad_harness.pdf_transcribe import (PT_TO_MM, audit_dxf, fit_scale,
                                        transcribe_page, write_dxf)

BEZIER = [(10, 60), (40, 30), (70, 90), (110, 60)]


def de_casteljau(cps, t):
    pts = list(cps)
    while len(pts) > 1:
        pts = [((1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1])
               for a, b in zip(pts, pts[1:])]
    return pts[0]


def make_pdf(path):
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)

    # stroke + bezier
    shape = page.new_shape()
    shape.draw_line((10, 20), (110, 20))
    shape.draw_bezier(*[fitz.Point(*p) for p in BEZIER])
    shape.finish(color=(0, 0, 0), width=0.5)
    shape.commit()

    # filled triangle whose last vertex does NOT repeat the first (implicit close)
    tri = page.new_shape()
    tri.draw_line((160, 20), (200, 20))
    tri.draw_line((200, 20), (180, 55))
    tri.draw_line((180, 55), (160, 20))
    tri.finish(fill=(0, 0, 0), color=None, width=0)
    tri.commit()

    # donut: outer rect + inner rect in one filled drawing (even-odd hole)
    donut = page.new_shape()
    donut.draw_rect(fitz.Rect(220, 20, 280, 80))
    donut.draw_rect(fitz.Rect(240, 40, 260, 60))
    donut.finish(fill=(0.2, 0.2, 0.2), color=None, width=0)
    donut.commit()

    # dashed stroke
    dash = page.new_shape()
    dash.draw_line((10, 150), (120, 150))
    dash.finish(color=(0, 0, 0), width=0.3, dashes="[3 2] 0")
    dash.commit()

    page.insert_text((20, 15), "32mm", fontsize=8)
    page.insert_text((20, 190), "16mm", fontsize=6)
    doc.save(path)
    doc.close()


@unittest.skipUnless(HAS_FITZ and HAS_EZDXF, "PyMuPDF/ezdxf required")
class TranscribeV3Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pdf = os.path.join(self.tmp, "t.pdf")
        make_pdf(self.pdf)
        self.res = transcribe_page(self.pdf)
        self.dxf = os.path.join(self.tmp, "t.dxf")
        self.out = write_dxf(self.res, self.dxf)

    def _msp(self):
        return ezdxf.readfile(self.dxf).modelspace()

    def test_units_and_scale(self):
        self.assertEqual(ezdxf.readfile(self.dxf).units, 4)

    def test_implicit_fill_closure_makes_hatch(self):
        hats = [e for e in self._msp() if e.dxftype() == "HATCH"]
        self.assertGreaterEqual(len(hats), 2, "triangle without repeated first point must still hatch")

    def test_hole_kept_as_second_ring(self):
        hats = [e for e in self._msp() if e.dxftype() == "HATCH"]
        ring_counts = sorted(len(h.paths) for h in hats)
        self.assertIn(2, ring_counts, f"donut must be one hatch with two rings, got {ring_counts}")

    def test_bezier_control_points(self):
        sp = [e for e in self._msp() if e.dxftype() == "SPLINE"][0]
        cps = [(p[0], p[1]) for p in sp.control_points]
        expected = [(x * PT_TO_MM, (200 - y) * PT_TO_MM) for x, y in BEZIER]
        for a, b in zip(cps, expected):
            self.assertLess(math.dist(a, b), 1e-6)
        bs = BSpline(cps, order=4)
        for t in (0.0, 0.5, 1.0):
            p = bs.point(t)
            self.assertLess(math.dist((p.x, p.y), de_casteljau(cps, t)), 1e-6)

    def test_dash_preserved(self):
        dashed = [e for e in self._msp() if e.dxftype() == "LWPOLYLINE"
                  and e.dxf.hasattr("linetype") and e.dxf.linetype not in ("ByLayer", "Continuous")]
        self.assertGreaterEqual(len(dashed), 1)

    def test_audit_ok(self):
        assert audit_dxf(self.dxf, self.out["provenance"])["ok"]

    def test_audit_detects_units_change(self):
        doc = ezdxf.readfile(self.dxf)
        doc.units = 1
        bad = os.path.join(self.tmp, "u.dxf")
        doc.saveas(bad)
        rep = audit_dxf(bad, self.out["provenance"])
        self.assertIn("UNITS_CHANGED", {p["kind"] for p in rep["problems"]})

    def test_audit_detects_hatch_ring_removal(self):
        doc = ezdxf.readfile(self.dxf)
        hatch = next(e for e in doc.modelspace() if e.dxftype() == "HATCH" and len(e.paths) == 2)
        hatch.paths.paths.pop(1)  # BoundaryPaths.paths is the underlying list
        bad = os.path.join(self.tmp, "h.dxf")
        doc.saveas(bad)
        rep = audit_dxf(bad, self.out["provenance"])
        self.assertIn("HATCH_RING_COUNT", {p["kind"] for p in rep["problems"]})

    def test_audit_detects_deleted_entity(self):
        doc = ezdxf.readfile(self.dxf)
        msp = doc.modelspace()
        msp.delete_entity(next(e for e in msp if e.dxftype() == "TEXT"))
        bad = os.path.join(self.tmp, "d.dxf")
        doc.saveas(bad)
        rep = audit_dxf(bad, self.out["provenance"])
        self.assertIn("MISSING_ENTITY", {p["kind"] for p in rep["problems"]})

    def test_audit_detects_text_and_position_changes(self):
        doc = ezdxf.readfile(self.dxf)
        t = next(e for e in doc.modelspace() if e.dxftype() == "TEXT")
        t.dxf.text = "99mm"
        bad = os.path.join(self.tmp, "t1.dxf")
        doc.saveas(bad)
        self.assertIn("TEXT_CHANGED", {p["kind"] for p in audit_dxf(bad, self.out["provenance"])["problems"]})

        doc2 = ezdxf.readfile(self.dxf)
        pl = next(e for e in doc2.modelspace() if e.dxftype() == "LWPOLYLINE")
        pts = [(p[0], p[1]) for p in pl.get_points("xy")]
        pts[0] = (pts[0][0] + 5.0, pts[0][1])
        pl.set_points(pts)
        bad2 = os.path.join(self.tmp, "t2.dxf")
        doc2.saveas(bad2)
        self.assertIn("GEOMETRY_CHANGED", {p["kind"] for p in audit_dxf(bad2, self.out["provenance"])["problems"]})


class ScaleTests(unittest.TestCase):
    def test_two_directions_by_source_id(self):
        rep = fit_scale(
            [{"source_id": "s16", "mm": 16.0, "measured_mm": 66.09, "direction": [1, 0]},
             {"source_id": "s32", "mm": 32.0, "measured_mm": 132.18, "direction": [0, 1]}],
            [{"source_id": "s14", "mm": 14.0, "measured_mm": 57.83}])
        self.assertTrue(rep["fitted"])
        self.assertTrue(rep["cross_check_passed"])

    def test_same_direction_rejected(self):
        rep = fit_scale(
            [{"source_id": "a", "mm": 16.0, "measured_mm": 66.09, "direction": [1, 0]},
             {"source_id": "b", "mm": 32.0, "measured_mm": 132.18, "direction": [1, 0]}])
        self.assertFalse(rep["fitted"])

    def test_reused_source_id_fails_cross_check(self):
        rep = fit_scale(
            [{"source_id": "s16", "mm": 16.0, "measured_mm": 66.09, "direction": [1, 0]},
             {"source_id": "s32", "mm": 32.0, "measured_mm": 132.18, "direction": [0, 1]}],
            [{"source_id": "s16", "mm": 16.0, "measured_mm": 66.09}])
        self.assertFalse(rep["cross_check_passed"])

    def test_missing_source_id_rejected(self):
        rep = fit_scale([{"mm": 16.0, "measured_mm": 66.09, "direction": [1, 0]}])
        self.assertFalse(rep["fitted"])


class RingGroupingTests(unittest.TestCase):
    def test_two_separate_triangles_are_two_outers(self):
        from cad_harness.pdf_transcribe import group_rings
        t1 = [(0, 0), (10, 0), (5, 8)]
        t2 = [(50, 0), (60, 0), (55, 8)]
        groups = group_rings([t1, t2])
        self.assertEqual(len(groups), 2, groups)
        self.assertTrue(all(len(g) == 1 for g in groups), groups)

    def test_outer_hole_and_separate_outer(self):
        from cad_harness.pdf_transcribe import group_rings
        outer = [(0, 0), (40, 0), (40, 40), (0, 40)]
        hole = [(10, 10), (30, 10), (30, 30), (10, 30)]
        other = [(100, 0), (120, 0), (110, 20)]
        groups = group_rings([outer, hole, other])
        self.assertEqual(len(groups), 2, groups)
        sizes = sorted(len(g) for g in groups)
        self.assertEqual(sizes, [1, 2], groups)
        big = next(g for g in groups if len(g) == 2)
        self.assertIn(hole, big)

    def test_nested_three_levels(self):
        from cad_harness.pdf_transcribe import group_rings
        a = [(0, 0), (100, 0), (100, 100), (0, 100)]
        b = [(20, 20), (80, 20), (80, 80), (20, 80)]
        c = [(40, 40), (60, 40), (60, 60), (40, 60)]
        groups = group_rings([a, b, c])
        # a outer, b hole, c island inside the hole -> ring count 3 in one hatch or two hatches
        total = sum(len(g) for g in groups)
        self.assertEqual(total, 3, groups)


@unittest.skipUnless(HAS_FITZ and HAS_EZDXF, "PyMuPDF/ezdxf required")
class FillGroupingDxfTests(unittest.TestCase):
    def _build(self, path):
        doc = fitz.open()
        page = doc.new_page(width=300, height=200)
        # one filled drawing holding two spatially separate triangles
        s = page.new_shape()
        s.draw_line((10, 10), (30, 10))
        s.draw_line((30, 10), (20, 30))
        s.draw_line((20, 30), (10, 10))
        s.draw_line((100, 10), (120, 10))
        s.draw_line((120, 10), (110, 30))
        s.draw_line((110, 30), (100, 10))
        s.finish(fill=(0, 0, 0), color=None, width=0)
        s.commit()
        doc.save(path)
        doc.close()

    def test_each_outer_is_filled(self):
        tmp = tempfile.mkdtemp()
        pdf = os.path.join(tmp, "f.pdf")
        self._build(pdf)
        res = transcribe_page(pdf)
        dxf = os.path.join(tmp, "f.dxf")
        out = write_dxf(res, dxf)
        hats = [e for e in ezdxf.readfile(dxf).modelspace() if e.dxftype() == "HATCH"]
        self.assertEqual(len(hats), 2, "two separated triangles must be two hatches")
        self.assertTrue(all(len(h.paths) == 1 for h in hats))
        self.assertTrue(audit_dxf(dxf, out["provenance"])["ok"])


if __name__ == "__main__":
    unittest.main()
