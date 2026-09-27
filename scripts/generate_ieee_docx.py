#!/usr/bin/env python3
"""
generate_ieee_docx.py
Converts the CommerceOS IEEE Project Proposal markdown into a professionally
formatted Microsoft Word (.docx) document adhering to IEEE project proposal standards.
Uses standard Python library (zipfile, xml.sax.saxutils, re, os) with zero external dependencies.
"""

import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

INPUT_MD_PATH = "/home/shown/.gemini/antigravity-ide/brain/76c3c203-34bb-493a-a966-5030b393ba57/commerceos_ieee_project_proposal.md"
OUTPUT_DOCX_PATHS = [
    "/mnt/g/OLama/CommerceOS/CommerceOS_IEEE_Project_Proposal.docx",
    "/home/shown/.gemini/antigravity-ide/brain/76c3c203-34bb-493a-a966-5030b393ba57/CommerceOS_IEEE_Project_Proposal.docx"
]

def clean_latex_to_text(text):
    """Convert common LaTeX math fragments to readable Unicode text."""
    replacements = [
        (r'\\ge', '≥'),
        (r'\\le', '≤'),
        (r'\\ne', '≠'),
        (r'\\pm', '±'),
        (r'\\times', '×'),
        (r'\\cdot', '·'),
        (r'\\rightarrow', '→'),
        (r'\\leftarrow', '←'),
        (r'\\Rightarrow', '⇒'),
        (r'\\tau', 'τ'),
        (r'\\parallel', ' ∥ '),
        (r'\\in', ' ∈ '),
        (r'\\land', ' ∧ '),
        (r'\\lor', ' ∨ '),
        (r'\\mathcal\{F\}', 'F'),
        (r'\\mathcal\{C\}', 'C'),
        (r'\\mathcal\{N\}', 'N'),
        (r'\\mathcal\{L\}', 'L'),
        (r'\\mathcal\{P\}', 'P'),
        (r'\\mathcal\{K\}', 'K'),
        (r'\\text\{([^}]+)\}', r'\1'),
        (r'\\texttt\{([^}]+)\}', r'\1'),
        (r'\\mathbf\{([^}]+)\}', r'\1'),
        (r'\\begin\{aligned\}', ''),
        (r'\\end\{aligned\}', ''),
        (r'\\\\', '\n'),
        (r'\&', ' '),
        (r'\\;', ' '),
        (r'_\{([^}]+)\}', r'_\1'),
        (r'\^\{([^}]+)\}', r'^\1'),
    ]
    for pattern, repl in replacements:
        text = re.sub(pattern, repl, text)
    return text

def parse_inline_formatting(text):
    """
    Parses bold, italic, inline code, and inline math into Word XML runs.
    Returns XML string of <w:r> elements.
    """
    # First, handle inline math $...$
    def math_sub(m):
        return "⟨MATH⟩" + clean_latex_to_text(m.group(1)) + "⟨/MATH⟩"
    text = re.sub(r'\$([^$]+)\$', math_sub, text)

    # Tokenize into runs: bold/italic, bold, italic, code, math, normal
    # We will use regex matching for:
    # ***bolditalic***, **bold**, *italic*, `code`, ⟨MATH⟩math⟨/MATH⟩
    pattern = re.compile(
        r'(\*\*\*(.*?)\*\*\*|'
        r'\*\*(.*?)\*\*|'
        r'\*(.*?)\*|'
        r'`(.*?)`|'
        r'⟨MATH⟩(.*?)⟨/MATH⟩)'
    )

    runs_xml = []
    last_idx = 0

    for match in pattern.finditer(text):
        start, end = match.span()
        if start > last_idx:
            plain = text[last_idx:start]
            if plain:
                runs_xml.append(f'<w:r><w:t xml:space="preserve">{escape(plain)}</w:t></w:r>')

        full_match = match.group(1)
        if match.group(2) is not None:  # ***bold italic***
            c = match.group(2)
            runs_xml.append(f'<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">{escape(c)}</w:t></w:r>')
        elif match.group(3) is not None:  # **bold**
            c = match.group(3)
            runs_xml.append(f'<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">{escape(c)}</w:t></w:r>')
        elif match.group(4) is not None:  # *italic*
            c = match.group(4)
            runs_xml.append(f'<w:r><w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">{escape(c)}</w:t></w:r>')
        elif match.group(5) is not None:  # `code`
            c = match.group(5)
            runs_xml.append(
                f'<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                f'<w:color w:val="A31515"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F6"/>'
                f'<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>'
                f'<w:t xml:space="preserve">{escape(c)}</w:t></w:r>'
            )
        elif match.group(6) is not None:  # Math
            c = match.group(6)
            runs_xml.append(
                f'<w:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>'
                f'<w:i/><w:iCs/><w:color w:val="1F4E79"/></w:rPr>'
                f'<w:t xml:space="preserve">{escape(c)}</w:t></w:r>'
            )
        last_idx = end

    if last_idx < len(text):
        plain = text[last_idx:]
        if plain:
            runs_xml.append(f'<w:r><w:t xml:space="preserve">{escape(plain)}</w:t></w:r>')

    if not runs_xml:
        return '<w:r><w:t></w:t></w:r>'
    return "".join(runs_xml)

def build_paragraph(text, style="Normal", align=None, space_before=0, space_after=120, indent_left=0, indent_right=0, hanging=0, bg_fill=None, border_left=None):
    pPr = ["<w:pPr>"]
    if style != "Normal":
        pPr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        pPr.append(f'<w:jc w:val="{align}"/>')

    spacing_attrs = []
    if space_before > 0:
        spacing_attrs.append(f'w:before="{space_before}"')
    if space_after > 0:
        spacing_attrs.append(f'w:after="{space_after}"')
    spacing_attrs.append('w:line="276" w:lineRule="auto"')
    pPr.append(f'<w:spacing {" ".join(spacing_attrs)}/>')

    if indent_left > 0 or indent_right > 0 or hanging > 0:
        ind_attrs = []
        if indent_left > 0:
            ind_attrs.append(f'w:left="{indent_left}"')
        if indent_right > 0:
            ind_attrs.append(f'w:right="{indent_right}"')
        if hanging > 0:
            ind_attrs.append(f'w:hanging="{hanging}"')
        pPr.append(f'<w:ind {" ".join(ind_attrs)}/>')

    if bg_fill:
        pPr.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{bg_fill}"/>')

    if border_left:
        pPr.append(f'<w:pBdr><w:left w:val="single" w:sz="24" w:space="15" w:color="{border_left}"/></w:pBdr>')

    pPr.append("</w:pPr>")
    runs = parse_inline_formatting(text)
    return f'<w:p>{"".join(pPr)}{runs}</w:p>'

def build_display_math_paragraph(math_text):
    cleaned = clean_latex_to_text(math_text).strip()
    return (
        f'<w:p>'
        f'<w:pPr>'
        f'<w:jc w:val="center"/>'
        f'<w:spacing w:before="160" w:after="160" w:line="280" w:lineRule="auto"/>'
        f'<w:ind w:left="400" w:right="400"/>'
        f'<w:shd w:val="clear" w:color="auto" w:fill="F7F9FB"/>'
        f'<w:pBdr>'
        f'<w:top w:val="single" w:sz="6" w:space="6" w:color="D0D7DE"/>'
        f'<w:bottom w:val="single" w:sz="6" w:space="6" w:color="D0D7DE"/>'
        f'</w:pBdr>'
        f'</w:pPr>'
        f'<w:r>'
        f'<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/><w:sz w:val="21"/><w:color w:val="1F4E79"/></w:rPr>'
        f'<w:t xml:space="preserve">{escape(cleaned)}</w:t>'
        f'</w:r>'
        f'</w:p>'
    )

def build_code_block(code_lines, language=""):
    p_elements = []
    total = len(code_lines)
    for idx, line in enumerate(code_lines):
        before = 80 if idx == 0 else 0
        after = 80 if idx == total - 1 else 0
        p_elements.append(
            f'<w:p>'
            f'<w:pPr>'
            f'<w:spacing w:before="{before}" w:after="{after}" w:line="220" w:lineRule="auto"/>'
            f'<w:ind w:left="360" w:right="360"/>'
            f'<w:shd w:val="clear" w:color="auto" w:fill="F4F5F7"/>'
            f'<w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="1F4E79"/></w:pBdr>'
            f'</w:pPr>'
            f'<w:r>'
            f'<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="17"/><w:szCs w:val="17"/><w:color w:val="242529"/></w:rPr>'
            f'<w:t xml:space="preserve">{escape(line)}</w:t>'
            f'</w:r>'
            f'</w:p>'
        )
    return "".join(p_elements)

def build_table(rows):
    """
    Builds a beautifully styled Word OpenXML table.
    rows: list of list of string cells. First row is considered header.
    """
    if not rows:
        return ""

    num_cols = max(len(r) for r in rows)
    # Total table width in twips for Letter page with 1-inch margins = 8.5in - 2in = 6.5in = 9360 twips
    total_width = 9360
    col_width = int(total_width / num_cols)

    tbl_xml = [
        '<w:tbl>',
        '<w:tblPr>',
        f'<w:tblW w:w="{total_width}" w:type="dxa"/>',
        '<w:jc w:val="center"/>',
        '<w:tblBorders>',
        '<w:top w:val="single" w:sz="8" w:space="0" w:color="1F4E79"/>',
        '<w:left w:val="none"/>',
        '<w:bottom w:val="single" w:sz="12" w:space="0" w:color="1F4E79"/>',
        '<w:right w:val="none"/>',
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E1E4E8"/>',
        '<w:insideV w:val="none"/>',
        '</w:tblBorders>',
        '<w:tblCellMar>',
        '<w:top w:w="120" w:type="dxa"/>',
        '<w:left w:w="160" w:type="dxa"/>',
        '<w:bottom w:w="120" w:type="dxa"/>',
        '<w:right w:w="160" w:type="dxa"/>',
        '</w:tblCellMar>',
        '</w:tblPr>',
        '<w:tblGrid>'
    ]

    for _ in range(num_cols):
        tbl_xml.append(f'<w:gridCol w:w="{col_width}"/>')
    tbl_xml.append('</w:tblGrid>')

    for row_idx, row in enumerate(rows):
        is_header = (row_idx == 0)
        is_alt = (row_idx % 2 == 1 and not is_header)

        tbl_xml.append('<w:tr>')
        trPr = ['<w:trPr>']
        if is_header:
            trPr.append('<w:tblHeader/>')
            trPr.append('<w:cantSplit/>')
        tbl_xml.append("".join(trPr) + '</w:trPr>')

        for cell_idx in range(num_cols):
            cell_text = row[cell_idx] if cell_idx < len(row) else ""
            tbl_xml.append('<w:tc>')
            tcPr = [f'<w:tcPr><w:tcW w:w="{col_width}" w:type="dxa"/>']

            if is_header:
                tcPr.append('<w:shd w:val="clear" w:color="auto" w:fill="1F4E79"/>')
            elif is_alt:
                tcPr.append('<w:shd w:val="clear" w:color="auto" w:fill="F8F9FA"/>')
            tcPr.append('<w:vAlign w:val="center"/>')
            tcPr.append('</w:tcPr>')
            tbl_xml.append("".join(tcPr))

            # Cell text
            cell_pPr = ['<w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/>']
            cell_pPr.append('</w:pPr>')

            if is_header:
                runs = parse_inline_formatting(f"**{cell_text}**")
                # Ensure white font in header
                runs = runs.replace('<w:rPr>', '<w:rPr><w:color w:val="FFFFFF"/>')
                runs = runs.replace('<w:r><w:t', '<w:r><w:rPr><w:color w:val="FFFFFF"/><w:b/></w:rPr><w:t')
            else:
                runs = parse_inline_formatting(cell_text)

            tbl_xml.append(f'<w:p>{"".join(cell_pPr)}{runs}</w:p>')
            tbl_xml.append('</w:tc>')

        tbl_xml.append('</w:tr>')

    tbl_xml.append('</w:tbl>')
    # Add a little spacing after table
    tbl_xml.append('<w:p><w:pPr><w:spacing w:after="140"/></w:pPr></w:p>')
    return "".join(tbl_xml)

def convert_markdown_to_docx_body(md_content):
    lines = md_content.split('\n')
    body_xml = []

    in_code_block = False
    code_lang = ""
    code_lines = []

    in_table = False
    table_rows = []

    in_display_math = False
    math_lines = []

    i = 0
    while i < len(lines):
        line = lines[i]

        # Handle math block $$ ... $$
        if line.strip().startswith('$$') and not in_code_block:
            if in_display_math:
                # closing
                math_lines.append(line.strip().replace('$$', ''))
                body_xml.append(build_display_math_paragraph(" ".join(math_lines)))
                in_display_math = False
                math_lines = []
                i += 1
                continue
            else:
                rest = line.strip()[2:]
                if rest.endswith('$$') and len(rest) > 2:
                    # Single-line math
                    body_xml.append(build_display_math_paragraph(rest[:-2]))
                    i += 1
                    continue
                else:
                    in_display_math = True
                    math_lines = [rest]
                    i += 1
                    continue

        if in_display_math:
            if line.strip().endswith('$$'):
                math_lines.append(line.strip()[:-2])
                body_xml.append(build_display_math_paragraph(" ".join(math_lines)))
                in_display_math = False
                math_lines = []
            else:
                math_lines.append(line)
            i += 1
            continue

        # Handle code blocks ```
        if line.strip().startswith('```'):
            if in_code_block:
                body_xml.append(build_code_block(code_lines, code_lang))
                in_code_block = False
                code_lines = []
                code_lang = ""
            else:
                in_code_block = True
                code_lang = line.strip()[3:].strip()
                code_lines = []
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        # Handle table rows
        if line.strip().startswith('|') and line.strip().endswith('|'):
            # Check if divider line
            if re.match(r'^\|[\s\-:|]+\|$', line.strip()):
                # Table divider line, skip
                i += 1
                continue
            cells = [c.strip() for c in line.strip()[1:-1].split('|')]
            if not in_table:
                in_table = True
                table_rows = [cells]
            else:
                table_rows.append(cells)
            i += 1
            continue
        else:
            if in_table:
                body_xml.append(build_table(table_rows))
                in_table = False
                table_rows = []

        stripped = line.strip()

        # Empty line
        if not stripped:
            i += 1
            continue

        # Horizontal rule
        if stripped in ('---', '***', '___'):
            body_xml.append(
                '<w:p><w:pPr>'
                '<w:spacing w:before="120" w:after="160"/>'
                '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="1F4E79"/></w:pBdr>'
                '</w:pPr></w:p>'
            )
            i += 1
            continue

        # Headings
        if stripped.startswith('# '):
            title_text = stripped[2:].strip()
            body_xml.append(build_paragraph(title_text, style="ProposalTitle", align="center", space_before=240, space_after=160))
            i += 1
            continue

        if stripped.startswith('## '):
            h1_text = stripped[3:].strip()
            body_xml.append(build_paragraph(h1_text, style="Heading1", space_before=280, space_after=100))
            i += 1
            continue

        if stripped.startswith('### '):
            h2_text = stripped[4:].strip()
            body_xml.append(build_paragraph(h2_text, style="Heading2", space_before=200, space_after=80))
            i += 1
            continue

        if stripped.startswith('#### '):
            h3_text = stripped[5:].strip()
            body_xml.append(build_paragraph(h3_text, style="Heading3", space_before=160, space_after=60))
            i += 1
            continue

        # Bullet list
        if stripped.startswith(('* ', '- ', '+ ')):
            bullet_text = stripped[2:].strip()
            body_xml.append(build_paragraph(f"•  {bullet_text}", style="ListBullet", space_before=40, space_after=40, indent_left=360, hanging=240))
            i += 1
            continue

        # Numbered list
        m_num = re.match(r'^(\d+)\.\s+(.*)$', stripped)
        if m_num:
            num_val = m_num.group(1)
            item_text = m_num.group(2)
            body_xml.append(build_paragraph(f"{num_val}.  {item_text}", style="ListNumber", space_before=40, space_after=40, indent_left=360, hanging=240))
            i += 1
            continue

        # Blockquote
        if stripped.startswith('> '):
            quote_text = stripped[2:].strip()
            body_xml.append(build_paragraph(quote_text, style="Quote", indent_left=400, indent_right=400, space_before=80, space_after=80, bg_fill="F9FAFB", border_left="1F4E79"))
            i += 1
            continue

        # Abstract handling: check if line begins with "Abstract—" or "Index Terms—"
        if stripped.startswith('**Abstract**') or stripped.startswith('Abstract:'):
            body_xml.append(build_paragraph(stripped, style="AbstractStyle", align="both", indent_left=480, indent_right=480, space_before=160, space_after=120))
            i += 1
            continue

        if stripped.startswith('**Index Terms**') or stripped.startswith('Index Terms:'):
            body_xml.append(build_paragraph(stripped, style="IndexTermsStyle", align="both", indent_left=480, indent_right=480, space_before=80, space_after=200))
            i += 1
            continue

        # Default normal paragraph
        body_xml.append(build_paragraph(stripped, style="Normal", align="both", space_before=0, space_after=100))
        i += 1

    if in_table:
        body_xml.append(build_table(table_rows))

    if in_code_block:
        body_xml.append(build_code_block(code_lines, code_lang))

    return "\n".join(body_xml)


def generate_docx():
    print(f"Reading markdown source from {INPUT_MD_PATH}...")
    with open(INPUT_MD_PATH, 'r', encoding='utf-8') as f:
        md_text = f.read()

    body_xml_content = convert_markdown_to_docx_body(md_text)

    # 1. [Content_Types].xml
    content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

    # 2. _rels/.rels
    rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

    # 3. word/_rels/document.xml.rels
    doc_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"""

    # 4. word/styles.xml
    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:color w:val="242529"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="276" w:lineRule="auto" w:after="100"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ProposalTitle">
    <w:name w:val="Proposal Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="240" w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
      <w:b/>
      <w:bCs/>
      <w:sz w:val="34"/>
      <w:szCs w:val="34"/>
      <w:color w:val="1F4E79"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="Heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="280" w:after="100"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="1F4E79"/></w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
      <w:b/>
      <w:bCs/>
      <w:sz w:val="26"/>
      <w:szCs w:val="26"/>
      <w:color w:val="1F4E79"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="Heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>
      <w:b/>
      <w:bCs/>
      <w:sz w:val="23"/>
      <w:szCs w:val="23"/>
      <w:color w:val="242529"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="Heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="160" w:after="60"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
      <w:b/>
      <w:i/>
      <w:sz w:val="21"/>
      <w:szCs w:val="21"/>
      <w:color w:val="333333"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="AbstractStyle">
    <w:name w:val="Abstract Style"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="480" w:right="480"/>
      <w:jc w:val="both"/>
      <w:spacing w:before="120" w:after="100"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="IndexTermsStyle">
    <w:name w:val="Index Terms Style"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="480" w:right="480"/>
      <w:jc w:val="both"/>
      <w:spacing w:before="60" w:after="200"/>
    </w:pPr>
    <w:rPr>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="360" w:hanging="240"/>
      <w:spacing w:before="30" w:after="30"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="ListNumber">
    <w:name w:val="List Number"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:left="360" w:hanging="240"/>
      <w:spacing w:before="30" w:after="30"/>
    </w:pPr>
  </w:style>
</w:styles>"""

    # 5. word/header1.xml
    header_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pStyle w:val="Header"/>
      <w:jc w:val="right"/>
      <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="CCCCCC"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/><w:color w:val="777777"/></w:rPr>
      <w:t>IEEE Project Proposal | CommerceOS: Agentic E-Commerce Automation OS</w:t>
    </w:r>
  </w:p>
</w:hdr>"""

    # 6. word/footer1.xml
    footer_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pStyle w:val="Footer"/>
      <w:jc w:val="center"/>
      <w:pBdr><w:top w:val="single" w:sz="4" w:space="2" w:color="CCCCCC"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="17"/><w:color w:val="777777"/></w:rPr>
      <w:t>Page </w:t>
    </w:r>
    <w:fldSimple w:instr="PAGE"/>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="17"/><w:color w:val="777777"/></w:rPr>
      <w:t> of </w:t>
    </w:r>
    <w:fldSimple w:instr="NUMPAGES"/>
  </w:p>
</w:ftr>"""

    # 7. word/document.xml
    # Section properties: Letter (8.5 x 11 in) = 12240 x 15840 twips. Margins = 1 inch (1440 twips)
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    {body_xml_content}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHeader1"/>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>"""

    # 8. docProps/core.xml
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>CommerceOS: IEEE Project Proposal</dc:title>
  <dc:subject>Agentic Multi-Tenant E-Commerce Automation Operating System</dc:subject>
  <dc:creator>CommerceOS Engineering Team</dc:creator>
  <cp:keywords>Agentic AI, Conversational Commerce, Deterministic Policy, Multi-Tenant SaaS, RAG, n8n</cp:keywords>
  <dc:description>Academic project proposal following IEEE standard methodology for CommerceOS.</dc:description>
  <cp:lastModifiedBy>CommerceOS Engineering Team</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:modified>
</cp:coreProperties>"""

    # 9. docProps/app.xml
    app_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Template>Normal.dotm</Template>
  <TotalTime>10</TotalTime>
  <Pages>12</Pages>
  <Words>3200</Words>
  <Characters>19000</Characters>
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <Lines>140</Lines>
  <Paragraphs>95</Paragraphs>
  <Company>Department of Computer Science and Engineering</Company>
</Properties>"""

    files_dict = {
        "[Content_Types].xml": content_types_xml,
        "_rels/.rels": rels_xml,
        "word/_rels/document.xml.rels": doc_rels_xml,
        "word/styles.xml": styles_xml,
        "word/header1.xml": header_xml,
        "word/footer1.xml": footer_xml,
        "word/document.xml": document_xml,
        "docProps/core.xml": core_xml,
        "docProps/app.xml": app_xml,
    }

    for out_path in OUTPUT_DOCX_PATHS:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        print(f"Packaging OpenXML zip to {out_path}...")
        with zipfile.ZipFile(out_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for file_name, file_content in files_dict.items():
                zf.writestr(file_name, file_content.encode('utf-8'))
        file_size = os.path.getsize(out_path)
        print(f"Successfully generated: {out_path} ({file_size:,} bytes)")

if __name__ == "__main__":
    generate_docx()
