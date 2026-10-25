#!/usr/bin/env python3
"""Apply Step 3 (Related Work / Research Gap / References) corrections.

- Idempotently edits the canonical Markdown draft research/paper_draft.md.
- Builds NetraSense_Research_Paper_Step3_Final.docx from the master DOCX
  (NetraSense_Research_Paper_Parts3_4_5_6_Updated.docx) by applying identical
  text-node replacements, inserting one scope paragraph, and appending three
  appendix items. The master DOCX is never modified.

The master DOCX is a naive markdown-to-XML conversion: body paragraphs carry
the markdown text verbatim inside <w:t> nodes, so the same OLD strings that
match the Markdown draft also match inside word/document.xml. Escaping of
'&' and stray '<' inside text nodes is applied so the generated DOCX is
genuinely well-formed XML.
"""
from __future__ import annotations

import re
import zipfile

MD = "research/paper_draft.md"
MASTER_DOCX = "NetraSense_Research_Paper_Parts3_4_5_6_Updated.docx"
OUT_DOCX = "NetraSense_Research_Paper_Step3_Final.docx"

# (name, old, new); applied when NEW is absent and OLD occurs exactly once.
REPLACEMENTS = [
    (
        "R1-ali-device-details",
        "More recent work has compared ultrasonic-based assistive devices with conventional aids in participant studies [4].",
        "More recent work has designed and evaluated two electronic obstacle-detection aids for visually impaired users, a wearable smart belt and a handheld smart stick, in participant comparisons against a conventional white cane [4].",
    ),
    (
        "R2-freshness-receipt-time-proxy",
        "excluded from the live ultrasonic contribution.",
        "excluded from the live ultrasonic contribution. Because the Arduino firmware transmits no source-side acquisition timestamp, this freshness assessment is computed from host receipt time; it is therefore a practical freshness proxy rather than a direct measurement of true Age of Information.",
    ),
    (
        "R3-research-gap-clarification",
        "The project does **not** solve verified obstacle avoidance or navigation safety.",
        "The project does **not** solve verified obstacle avoidance or navigation safety. The sensing combination itself is established in prior work; the gap addressed here concerns explicit, testable behavior for missing, invalid, and stale observations, disciplined system-status reporting, and a reproducible evaluation path, rather than an unexplored sensing technology.",
    ),
    (
        "R4-modality-labels-not-fault-diagnosis",
        "The ensemble separately expresses `FUSED`, `SENSOR DEGRADED`, and `NO VALID DATA`, which concern the availability of fusion inputs rather than a claim of physical safety.",
        "The ensemble separately expresses `FUSED`, `SENSOR DEGRADED`, and `NO VALID DATA`, which concern the availability of fusion inputs rather than a claim of physical safety or a hardware-fault diagnosis: `SENSOR DEGRADED` and `FUSED` count contributing modalities, and a degraded label can arise simply because one modality has no fresh valid observation.",
    ),
    (
        "R5-distinct-fields-no-data-vs-no-valid-data",
        "the output threat is `NO DATA` and the sensing state is `NO VALID DATA`. If",
        "the output threat is `NO DATA` and the sensing state is `NO VALID DATA`; these are two distinct fields of the same result, a threat-level fallback and an input-availability state, not interchangeable. If",
    ),
    (
        "R6-reference4-doi",
        "2023. doi: [10.1006/jer.2023.0132](https://doi.org/10.1006/jer.2023.0132).",
        "2023. doi: [10.1016/j.jer.2023.100132](https://doi.org/10.1016/j.jer.2023.100132).",
    ),
    (
        "R7-appendix-item2-clarified",
        "`NO VALID DATA` is the initial state value in the result structure, not a separate runtime state.",
        "`NO VALID DATA` is the result structure's initial state value and is also the runtime sensing state whenever no valid observation is available (the `fused_threat_level` field then falls back to `NO DATA`); the two `NO` labels are separate fields with different meanings.",
    ),
]

APPENDIX_MARKER = "13. **Novelty framing.**"

SCOPE_PARA = (
    "The reviewed literature is a selective, topic-focused sample rather than a completed "
    "systematic review. Vision-based detection, ultrasonic ranging, multimodal sensor fusion, "
    "embedded warning devices, and timeliness-aware processing are established research areas; "
    "the combination of vision and ultrasound for obstacle detection is not claimed here to be "
    "new. The features emphasized in this paper - explicit input validation, missing/invalid/"
    "stale-data handling, receipt-time freshness assessment, conservative decision-level fusion "
    "outputs, and explicit sensing-state reporting - are implementation-level design choices "
    "rather than proven first-of-kind inventions. Their purpose in this work is to make the "
    "prototype's behavior explicit, testable, and reproducible; whether they improve any outcome "
    "relative to existing systems is an empirical question that this paper leaves open."
)

APPENDIX_ITEMS = (
    "13. **Novelty framing.** A Related Work scope statement and a Section 3 clarification state that the literature review is selective rather than a completed systematic review, that vision-ultrasound obstacle detection and fusion are established prior work, and that input validation, missing/invalid/stale-data handling, receipt-time freshness assessment, conservative fusion outputs, and sensing-state reporting are implementation-level design choices rather than proven first-of-kind inventions.\n"
    "14. **Freshness semantics.** The Related Work freshness paragraph states explicitly that the firmware transmits no acquisition timestamp, so the host receipt-time assessment is a freshness proxy rather than a direct Age-of-Information measurement.\n"
    "15. **Reference verification.** All five references were re-verified against publisher records; reference [4]'s DOI was corrected from the unresolvable 10.1006/jer.2023.0132 to 10.1016/j.jer.2023.100132, and its Related Work sentence updated to the published device descriptions (wearable smart belt and handheld smart stick compared with a white cane).\n"
)


def apply_replacements(text: str, kind: str) -> str:
    for name, old, new in REPLACEMENTS:
        if kind == "docx":
            old = old.replace("&", "&amp;")
            new = new.replace("&", "&amp;")
        if new in text:
            print(f"[{kind}] {name}: already applied")
            continue
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"[{kind}] {name}: expected OLD present once, found {n}")
        text = text.replace(old, new, 1)
        print(f"[{kind}] {name}: replaced")
    return text


def main() -> None:
    # ── 1. Canonical Markdown draft ────────────────────────────────
    with open(MD, encoding="utf-8") as f:
        md = f.read()

    md = apply_replacements(md, "md")

    if SCOPE_PARA in md:
        print("[md] Related Work scope paragraph: already present")
    else:
        anchor = (
            "a practical freshness proxy rather than a direct measurement of true Age of Information.\n\n---"
        )
        if md.count(anchor) != 1:
            raise SystemExit("[md] scope anchor not found exactly once")
        md = md.replace(
            anchor,
            "a practical freshness proxy rather than a direct measurement of true Age of Information.\n\n"
            + SCOPE_PARA
            + "\n\n---",
            1,
        )
        print("[md] Related Work scope paragraph: inserted")

    if APPENDIX_MARKER in md:
        print("[md] appendix items 13-15: already present")
    else:
        md = md.rstrip("\n") + "\n" + APPENDIX_ITEMS
        print("[md] appendix items 13-15: appended")

    with open(MD, "w", encoding="utf-8") as f:
        f.write(md)

    # ── 2. DOCX generation from the untouched master ──────────────
    with zipfile.ZipFile(MASTER_DOCX) as z:
        xml = z.read("word/document.xml").decode("utf-8")

    xml = apply_replacements(xml, "docx")

    para_marker = f"<w:p ><w:r><w:t>{SCOPE_PARA}</w:t></w:r></w:p>"
    if SCOPE_PARA in xml:
        print("[docx] Related Work scope paragraph: already present")
    else:
        anchor = (
            "a practical freshness proxy rather than a direct measurement of true Age of Information."
            "</w:t></w:r></w:p>"
        )
        if xml.count(anchor) != 1:
            raise SystemExit("[docx] scope anchor not found exactly once")
        xml = xml.replace(
            anchor,
            anchor + para_marker,
            1,
        )
        print("[docx] Related Work scope paragraph: inserted")

    if APPENDIX_MARKER in xml:
        print("[docx] appendix items 13-15: already present")
    else:
        appendix_paras = "".join(
            f"<w:p ><w:r><w:t>{line}</w:t></w:r></w:p>"
            for line in APPENDIX_ITEMS.rstrip("\n").split("\n")
        )
        if xml.count("</w:document>") != 1:
            raise SystemExit("[docx] unexpected document tail")
        xml = xml.replace("</w:document>", appendix_paras + "</w:document>", 1)
        print("[docx] appendix items 13-15: appended")

    # ── 3. Escape invalid characters inside <w:t> text nodes ──────
    # The master document.xml embeds a raw '<' in body text ("2–<400 cm"),
    # which is not well-formed XML. Escape all stray '&' and '<' within
    # text-node contents so the generated DOCX is genuinely valid.
    def esc(m: re.Match) -> str:
        body = m.group(2).replace("&", "&amp;").replace("<", "&lt;")
        return m.group(1) + body + m.group(3)

    xml, n_esc = re.subn(r"(<w:t[^>]*>)(.*?)(</w:t>)", esc, xml, flags=re.S)
    print(f"[docx] text-node escaping applied to {n_esc} runs")

    with zipfile.ZipFile(MASTER_DOCX) as src, zipfile.ZipFile(
        OUT_DOCX, "w", zipfile.ZIP_DEFLATED
    ) as dst:
        for item in src.infolist():
            if item.filename == "word/document.xml":
                dst.writestr(item, xml.encode("utf-8"))
            else:
                dst.writestr(item, src.read(item.filename))
    print("saved:", OUT_DOCX)


if __name__ == "__main__":
    main()
