"""Assemble the engineering PDF and reproducible P3 archive after validation."""
import csv
import hashlib
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from build123d import export_step, import_step
from cad.assembly import build, compound
from cad.config import ROOT, load, source_digest

OUT = ROOT / "exports"
STYLES = getSampleStyleSheet()
font_root = Path("/usr/share/fonts/truetype/dejavu")
if (font_root / "DejaVuSans.ttf").exists():
    pdfmetrics.registerFont(TTFont("DejaVu", str(font_root / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(font_root / "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily("DejaVu", normal="DejaVu", bold="DejaVu-Bold",
                                 italic="DejaVu", boldItalic="DejaVu-Bold")
    for style in STYLES.byName.values():
        style.fontName = "DejaVu-Bold" if style.name.startswith("Heading") else "DejaVu"
STYLES["BodyText"].fontSize = 9
STYLES["BodyText"].leading = 13


def paragraph(text, style="BodyText"):
    text = escape(text)
    text = re.sub(r"\[([^]]+)\]\(([^)]+)\)", r'<link href="\2" color="#27634a">\1</link>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = text.replace("`", "")
    return Paragraph(text, STYLES[style])


def markdown(path):
    result, buffer = [], []
    def flush():
        if buffer:
            result.append(paragraph(" ".join(buffer)))
            result.append(Spacer(1, 6))
            buffer.clear()
    for line in path.read_text().splitlines():
        if not line.strip():
            flush()
        elif line.startswith("#"):
            flush()
            depth = len(line)-len(line.lstrip("#"))
            result.append(paragraph(line.lstrip("# "), "Heading1" if depth == 1 else "Heading2"))
        elif line.startswith("```"):
            flush()
        elif line.startswith("|"):
            flush()
            if not re.match(r"^\|[- :|]+\|$", line):
                result.append(paragraph(" · ".join(x.strip() for x in line.strip("|").split("|"))))
        else:
            buffer.append(line)
    flush()
    return result


def table(rows, widths):
    content = [[paragraph(str(cell)) for cell in row] for row in rows]
    t = Table(content, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dfeae2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), .3, colors.HexColor("#b4c5bc")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def main():
    manifest = json.loads((OUT / "manifest.json").read_text())
    assert manifest["cad_source_sha256"] == source_digest(), "Stale export"
    assert manifest["parameters"] == load(), (
        "Packaging requires the default measured configuration; "
        "move approved parameter changes into cad/parameters.json and revalidate."
    )
    reports = {}
    for kind in ["artifacts", "motion"]:
        reports[kind] = json.loads((OUT / "reports" / f"{kind}.json").read_text())
        assert reports[kind]["status"] == "passed", f"{kind} failed"
        assert reports[kind]["cad_source_sha256"] == source_digest(), f"{kind} stale"
    for report_name,allowed in {
        'mechanical-interfaces':{'passed'},'cable-routing':{'passed'},
        'dense-motion':{'passed'},'parameters-and-loads':{'hardware_qualification_pending'},
        'print-layers':{'screened'},'slicing':{'passed'},
    }.items():
        check=json.loads((OUT/'reports/preprint'/f'{report_name}.json').read_text())
        assert check['cad_source_sha256']==source_digest(),f'{report_name} stale'
        assert check['status'] in allowed,f'{report_name} failed or incomplete'
        if report_name == 'slicing':
            actual = {p['file']: hashlib.sha256((OUT/'plates'/p['file']).read_bytes()).hexdigest()
                      for p in manifest['plates']}
            assert {p['plate']: p['plate_sha256'] for p in check['plates']} == actual, "Stale sliced plates"
            assert {p['file']: p['sha256'] for p in reports['artifacts']['plates']} == actual, "Stale artifact plates"
    # A separate assembly lets the owner inspect the requested base actuator
    # without extracting its parts from the complete camera STEP.
    components, _ = build(load())
    actuator = {name: part for name, part in components.items()
                if name.startswith(("planetary_", "planet_", "sun_", "output_", "pan_"))}
    module = compound(actuator, load())
    module.label = "CAMX_Pro_Planetary_Actuator"
    actuator_path = OUT / "assembly/planetary-actuator.step"
    export_step(module, actuator_path)
    roundtrip = import_step(actuator_path)
    assert roundtrip.is_valid and len(roundtrip.solids()) == len(module.solids())
    (OUT / "reports/actuator.json").write_text(json.dumps({
        "status": "passed", "cad_source_sha256": source_digest(),
        "parts": list(actuator), "step_solids": len(roundtrip.solids()),
        "note": "Subassembly mounts to the camera base's motor and ring columns; hardware fits provisional."
    }, indent=2)+"\n")
    story = [paragraph("CAMX PRO", "Title"),
             paragraph("P3 / Engineering fit prototype", "Heading1"),
             paragraph("Bambu Lab A1 mini · build123d · intact Anker webcam"),
             Image(str(OUT / "images/three_quarter.png"), width=470, height=392),
             paragraph("PROVISIONAL: physical fit, motor load, wiring, thermal behavior and print trials remain pending."),
             PageBreak(), paragraph("Digital validation", "Heading1"),
             paragraph(f"{len(reports['artifacts']['parts'])} watertight print meshes; "
                       f"{len(reports['artifacts']['plates'])} A1 mini plate layouts; "
                       f"{len(reports['motion']['poses'])} sampled motion poses; "
                       f"{reports['motion']['pair_checks']} rigid pair checks."),
             paragraph("Samples are not continuous collision proof. Hardware is simplified; selected "
                       "fastener envelopes and prescribed pan cable paths have separate checks. Actual "
                       "fasteners, free cable tails and the tilt service loop require bench qualification. "
                       "Interactive browser testing has not been performed; model/joint checks and build "
                       "validation are recorded separately."),
             paragraph("CAD source SHA-256: " + source_digest()),
             paragraph("Part dimensions", "Heading2")]
    rows = [["Printable part", "Bed-oriented size (mm)"]]
    rows += [[name, " × ".join(f"{v:.1f}" for v in part["print_bounds_mm"])]
             for name, part in manifest["parts"].items() if part["printed"]]
    story += [table(rows, [280, 190]), PageBreak()]
    for name in ["p3-verification", "p3-design-closure", "c200-manufacturer-data", "motor-placement", "planetary-actuator", "measurements", "assembly", "wiring", "control-contract"]:
        story.extend(markdown(ROOT / "docs" / f"{name}.md"))
        story.append(PageBreak())
    story.append(paragraph("Bill of materials / provisional", "Heading1"))
    with (ROOT / "docs/bom.csv").open() as f:
        bom = list(csv.DictReader(f))
    story.append(table([["Item / quantity", "Nominal specification / qualification"]] +
                       [[f"{r['item']} — {r['quantity']}", f"{r['nominal specification']}. {r['status']}."]
                        for r in bom], [190, 280]))
    story.append(PageBreak())
    for name in ["front", "side", "rear", "top", "bottom"]:
        story += [paragraph(f"{name.title()} view / nominal dimensions", "Heading1"),
                  Image(str(OUT / "drawings" / f"{name}.png"), width=490, height=348),
                  paragraph("Matching vector SVG and individual PDF are included in drawings/."),
                  PageBreak()]
    for name in ["planetary_actuator", "exploded", "cutaway", "electronics", "pan_120", "tilt_75"]:
        story += [paragraph(name.replace("_", " ").title(), "Heading1"),
                  Image(str(OUT / "images" / f"{name}.png"), width=475, height=396),
                  paragraph("Engineering visualization from the same CAD source; hardware dimensions provisional."),
                  PageBreak()]
    def footer(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.drawString(50, 28, f"CAMX PRO / P3 / PROVISIONAL                                  {doc.page}")
    SimpleDocTemplate(str(OUT / "engineering.pdf"), pagesize=A4,
                      leftMargin=50, rightMargin=50, topMargin=45, bottomMargin=45).build(
                          story[:-1], onFirstPage=footer, onLaterPages=footer)
    files = [f for f in OUT.rglob("*") if f.is_file() and
             f.name not in ["camx-pro-prototype.zip", "checksums.sha256", "package-integrity.json"]]
    (OUT / "checksums.sha256").write_text("".join(
        f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(OUT)}\n" for f in sorted(files)))
    with ZipFile(OUT / "camx-pro-prototype.zip", "w", ZIP_DEFLATED) as archive:
        for f in files + [OUT / "checksums.sha256"]:
            archive.write(f, f.relative_to(ROOT))
        for directory in ["cad", "tools", "tests", "docs"]:
            for f in (ROOT / directory).rglob("*"):
                if f.is_file() and "__pycache__" not in f.parts:
                    archive.write(f, f.relative_to(ROOT))
        for name in ["README.md", "PLAN.md", "requirements.in", "requirements.txt", "requirements-audit.txt", "pyproject.toml"]:
            archive.write(ROOT / name, name)
        for name in ["package.json", "package-lock.json", "playwright.config.js"]:
            archive.write(ROOT / name, name)
        # Maintained application sources only; never include caches or staged binary downloads.
        for directory in ["apps/site", "apps/remote", "apps/tui", "packages", "contracts"]:
            for f in (ROOT / directory).rglob("*"):
                relative = f.relative_to(ROOT)
                if (f.is_file() and not any(part in {"node_modules", "dist", "out", "__pycache__", ".bsp", ".scala-build", "downloads"} for part in relative.parts)
                        and f.name not in {".env", "credentials.h", "secrets.h"}
                        and not f.name.startswith(".env.")):
                    archive.write(f, relative)
    print("Created engineering.pdf, checksums.sha256 and camx-pro-prototype.zip")


if __name__ == "__main__":
    main()
