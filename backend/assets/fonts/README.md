# Fonts the PDFs are drawn with

**Sarabun** (Regular and Bold), from Google Fonts, under the SIL Open Font
License 1.1 — the full licence is in `OFL.txt` beside this file and must stay
with the font files.

## Why it is here

PDFKit ships Helvetica, Times and Courier, and none of them has a single Thai
glyph. A label printed with them turns `แขวงสีลม` into `á...`, because the text
is written out in WinAnsi and every Thai code point lands on whatever Latin
character shares its byte. Nobody noticed while the demo data was English.

A delivery address on a shipping label is Thai in the ordinary case, so the
label needs a real Thai font embedded in the PDF.

Sarabun covers Thai and Latin in one family, is the face Thai government
documents use, stays legible small, and is ~88 KB per weight.

## Keeping them available at run time

`nest-cli.json` copies `assets/**` into `dist/assets`, and the code resolves the
files from `__dirname`, so the same path works from `src` under ts-node and from
`dist` in production. If a PDF ever renders Thai as Latin accents again, the
first thing to check is that these files reached `dist`.
