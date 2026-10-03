from __future__ import annotations

import os
import textwrap
from pathlib import Path

from reportlab.lib.colors import HexColor, Color, white, black
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path('/home/rafael/jamed-slide')
ICON_PATH = ROOT / 'Koasis Logo Final.png'
WORDMARK_PATH = ROOT / 'Koasis Wordmark Final.png'
OUT_PDF = ROOT / 'output/pdf/koasis-brand-guideline.pdf'
OUT_PNG = ROOT / 'output/preview/koasis-brand-guideline-overview.png'

PAGE_W, PAGE_H = landscape(A4)

# The logo contains a small blue range. These two colors are the most useful
# source-derived anchors for digital and print handoff; the logo artwork itself
# remains the source of truth for the subtle blue variation.
BLUE = '#0072FB'
BLUE_DEEP = '#005CFC'
INK = '#102A43'
SLATE = '#5B6B7A'
MIST = '#E7F2FF'
PALE = '#F4F9FF'
LINE = '#D6E6F7'
WHITE = '#FFFFFF'
RED = '#E04F5F'
GREEN = '#198754'


def register_fonts() -> None:
    regular = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'
    bold = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
    if os.path.exists(regular):
        pdfmetrics.registerFont(TTFont('Koasis Sans', regular))
    if os.path.exists(bold):
        pdfmetrics.registerFont(TTFont('Koasis Sans Bold', bold))


register_fonts()
FONT = 'Koasis Sans'
FONT_BOLD = 'Koasis Sans Bold'


def C(value: str) -> HexColor:
    return HexColor(value)


def draw_text(c: canvas.Canvas, text: str, x: float, y: float, size: float,
              font: str = FONT, color: str = INK, align: str = 'left') -> None:
    c.setFont(font, size)
    c.setFillColor(C(color))
    if align == 'right':
        c.drawRightString(x, y, text)
    elif align == 'center':
        c.drawCentredString(x, y, text)
    else:
        c.drawString(x, y, text)


def wrap_lines(text: str, font: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split('\n'):
        if not paragraph:
            lines.append('')
            continue
        words = paragraph.split()
        line = ''
        for word in words:
            candidate = word if not line else f'{line} {word}'
            if pdfmetrics.stringWidth(candidate, font, size) <= width:
                line = candidate
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
    return lines


def paragraph(c: canvas.Canvas, text: str, x: float, top: float, width: float,
              size: float = 10, leading: float = 14, font: str = FONT,
              color: str = INK, max_lines: int | None = None) -> float:
    lines = wrap_lines(text, font, size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    y = top
    for line in lines:
        if line:
            draw_text(c, line, x, y - size, size, font, color)
        y -= leading
    return y


def card(c: canvas.Canvas, x: float, y: float, w: float, h: float,
         fill: str = WHITE, stroke: str | None = None, radius: float = 12) -> None:
    c.saveState()
    c.setFillColor(C(fill))
    if stroke:
        c.setStrokeColor(C(stroke))
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, radius, fill=1, stroke=1)
    else:
        c.roundRect(x, y, w, h, radius, fill=1, stroke=0)
    c.restoreState()


def line(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float,
         color: str = LINE, width: float = 1, dashed: bool = False) -> None:
    c.saveState()
    c.setStrokeColor(C(color))
    c.setLineWidth(width)
    if dashed:
        c.setDash(4, 3)
    c.line(x1, y1, x2, y2)
    c.restoreState()


def image(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float,
          anchor: str = 'c') -> None:
    c.drawImage(str(path), x, y, width=w, height=h,
                preserveAspectRatio=True, anchor=anchor, mask='auto')


def pill(c: canvas.Canvas, text: str, x: float, y: float, w: float,
         fill: str = MIST, text_color: str = BLUE_DEEP) -> None:
    c.setFillColor(C(fill))
    c.roundRect(x, y, w, 22, 11, fill=1, stroke=0)
    draw_text(c, text, x + w / 2, y + 7, 8, FONT_BOLD, text_color, 'center')


def kicker(c: canvas.Canvas, text: str, x: float, y: float) -> None:
    draw_text(c, text.upper(), x, y, 8, FONT_BOLD, BLUE_DEEP)


def page_title(c: canvas.Canvas, title: str, subtitle: str | None = None) -> None:
    kicker(c, 'Koasis / Brand Guidelines', 52, PAGE_H - 42)
    draw_text(c, title, 52, PAGE_H - 78, 27, FONT_BOLD, INK)
    if subtitle:
        paragraph(c, subtitle, 52, PAGE_H - 108, 620, 10, 14, FONT, SLATE)


def footer(c: canvas.Canvas, number: int, label: str = 'Koasis Brand Guidelines  /  1.0') -> None:
    line(c, 52, 31, PAGE_W - 52, 31, LINE, 0.7)
    draw_text(c, label, 52, 17, 7.5, FONT, SLATE)
    draw_text(c, f'{number:02d}', PAGE_W - 52, 17, 7.5, FONT_BOLD, BLUE_DEEP, 'right')


def swatch(c: canvas.Canvas, x: float, y: float, w: float, h: float,
           color: str, name: str, hex_value: str, role: str,
           text_color: str = INK) -> None:
    c.setFillColor(C(color))
    c.roundRect(x, y, w, h, 10, fill=1, stroke=0)
    draw_text(c, name, x + 14, y + h - 23, 10, FONT_BOLD, text_color)
    draw_text(c, hex_value, x + 14, y + h - 39, 9, FONT, text_color)
    draw_text(c, role, x + 14, y + 14, 7.5, FONT, text_color)


def checkmark(c: canvas.Canvas, x: float, y: float, good: bool = True) -> None:
    c.setFillColor(C(GREEN if good else RED))
    c.circle(x, y, 8, fill=1, stroke=0)
    draw_text(c, 'OK' if good else 'X', x, y - 3, 6.5, FONT_BOLD, WHITE, 'center')


def draw_cover(c: canvas.Canvas) -> None:
    c.setFillColor(C(PALE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(C(MIST))
    c.roundRect(PAGE_W - 315, -45, 360, PAGE_H + 70, 42, fill=1, stroke=0)
    c.setFillColor(C('#D9EEFF'))
    c.circle(PAGE_W - 91, PAGE_H - 88, 105, fill=1, stroke=0)
    image(c, ICON_PATH, PAGE_W - 252, 205, 230, 230)
    pill(c, 'BRAND GUIDELINES  /  VERSION 1.0', 52, PAGE_H - 72, 183)
    image(c, WORDMARK_PATH, 52, 315, 480, 139)
    draw_text(c, 'A clear, human clinical experience', 55, 270, 18, FONT_BOLD, INK)
    paragraph(c,
              'A practical guide for using the Koasis identity with clarity, consistency, and care across digital and physical touchpoints.',
              55, 247, 420, 11, 16, FONT, SLATE)
    draw_text(c, 'Your Clinical Oasis', 55, 100, 12, FONT_BOLD, BLUE_DEEP)
    draw_text(c, 'Prepared from the approved Koasis logo and wordmark artwork.', 55, 80, 8.5, FONT, SLATE)
    draw_text(c, '03 October 2026', PAGE_W - 52, 35, 8, FONT, SLATE, 'right')


def draw_foundation(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Brand foundation', 'The strategic idea behind the Koasis identity.')
    card(c, 52, 265, 360, 220, PALE)
    kicker(c, '01 / Purpose', 76, 454)
    draw_text(c, 'Make clinical care feel', 76, 418, 20, FONT_BOLD, INK)
    draw_text(c, 'clear, calm, and human.', 76, 391, 20, FONT_BOLD, BLUE_DEEP)
    paragraph(c,
              'Koasis is a welcoming clinical oasis: a place where people can understand what is happening, feel supported, and move forward with confidence.',
              76, 360, 286, 10, 15, FONT, SLATE)
    card(c, 436, 265, 354, 220, WHITE, LINE)
    kicker(c, '02 / Personality', 460, 454)
    traits = [('CALM', 'Reduce friction and noise.'), ('CARING', 'Keep the human at the center.'),
              ('CLEAR', 'Make the next step obvious.'), ('CAPABLE', 'Signal clinical confidence.')]
    y = 416
    for label, desc in traits:
        c.setFillColor(C(MIST))
        c.circle(469, y + 4, 5, fill=1, stroke=0)
        draw_text(c, label, 484, y, 9, FONT_BOLD, BLUE_DEEP)
        draw_text(c, desc, 566, y, 9, FONT, SLATE)
        y -= 34
    card(c, 52, 83, 738, 140, INK)
    kicker(c, '03 / Visual idea', 76, 194)
    draw_text(c, 'A person, a device, and a spark of progress.', 76, 161, 17, FONT_BOLD, WHITE)
    paragraph(c,
              'The icon combines a seated human figure with a digital work gesture. The diagonal creates a memorable K-like energy, while the sparkle signals clarity, care, and forward movement.',
              76, 139, 500, 10, 15, FONT, '#D8E8F8')
    image(c, ICON_PATH, 672, 102, 88, 88)
    footer(c, 2)


def draw_logo_system(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Logo system', 'Use the approved artwork as a locked identity system.')
    card(c, 52, 250, 738, 245, PALE)
    kicker(c, 'Primary lockup', 76, 463)
    image(c, WORDMARK_PATH, 76, 313, 570, 165)
    line(c, 676, 300, 676, 458, LINE, 0.8)
    draw_text(c, 'Use when', 705, 434, 10, FONT_BOLD, INK)
    paragraph(c, 'The audience needs the full brand name and promise. This is the default for websites, decks, documents, and partner-facing materials.', 705, 414, 115, 8.5, 12, FONT, SLATE)
    card(c, 52, 83, 231, 132, WHITE, LINE)
    image(c, ICON_PATH, 103, 107, 95, 95)
    draw_text(c, 'Icon only', 171, 99, 9, FONT_BOLD, INK, 'center')
    draw_text(c, 'Favicon, app tile, avatar', 167, 85, 7.5, FONT, SLATE, 'center')
    card(c, 303, 83, 231, 132, WHITE, LINE)
    image(c, WORDMARK_PATH, 326, 132, 185, 54)
    draw_text(c, 'Horizontal lockup', 418, 99, 9, FONT_BOLD, INK, 'center')
    draw_text(c, 'Default external use', 418, 85, 7.5, FONT, SLATE, 'center')
    card(c, 554, 83, 236, 132, INK)
    draw_text(c, 'Rule', 578, 183, 9, FONT_BOLD, '#7FC6FF')
    paragraph(c, 'Do not rebuild the wordmark with a font. The letterforms, speech bubble in the a, dots, stars, spacing, and tagline are part of the artwork.', 578, 164, 182, 8.5, 12, FONT, WHITE)
    footer(c, 3)


def draw_clearspace(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Clear space and sizing', 'Let the mark breathe. The quiet area is part of the identity.')
    card(c, 52, 258, 465, 232, PALE)
    kicker(c, 'Clear space', 76, 461)
    image(c, WORDMARK_PATH, 91, 333, 360, 104)
    c.saveState()
    c.setStrokeColor(C(BLUE))
    c.setLineWidth(1.1)
    c.setDash(5, 4)
    c.rect(75, 317, 395, 136, fill=0, stroke=1)
    c.restoreState()
    draw_text(c, '0.5x minimum on every side', 92, 296, 9, FONT_BOLD, BLUE_DEEP)
    draw_text(c, 'x = diameter of the circular head in the icon.', 92, 282, 8, FONT, SLATE)
    card(c, 545, 258, 245, 232, WHITE, LINE)
    kicker(c, 'Icon safe area', 569, 461)
    image(c, ICON_PATH, 620, 330, 98, 98)
    c.saveState()
    c.setStrokeColor(C(BLUE))
    c.setLineWidth(1)
    c.setDash(5, 4)
    c.rect(602, 312, 134, 134, fill=0, stroke=1)
    c.restoreState()
    draw_text(c, '0.75x minimum', 670, 296, 8.5, FONT_BOLD, BLUE_DEEP, 'center')
    card(c, 52, 83, 738, 135, WHITE, LINE)
    kicker(c, 'Minimum reproduction', 76, 193)
    draw_text(c, 'Digital', 76, 163, 10, FONT_BOLD, INK)
    draw_text(c, 'Icon: 24 px minimum', 76, 143, 9, FONT, SLATE)
    draw_text(c, 'Full lockup: 240 px minimum', 76, 128, 9, FONT, SLATE)
    draw_text(c, 'Print', 338, 163, 10, FONT_BOLD, INK)
    draw_text(c, 'Icon: 8 mm minimum', 338, 143, 9, FONT, SLATE)
    draw_text(c, 'Full lockup: 60 mm minimum', 338, 128, 9, FONT, SLATE)
    draw_text(c, 'At smaller sizes, use icon only so the tagline stays legible.', 569, 148, 9, FONT_BOLD, BLUE_DEEP)
    paragraph(c, 'Never scale the wordmark and tagline independently. If the tagline cannot be read, switch to the approved icon-only asset.', 569, 130, 182, 8.5, 12, FONT, SLATE)
    footer(c, 4)


def draw_colors(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Color palette', 'A focused blue system balances clinical trust with digital energy.')
    draw_text(c, 'The logo artwork contains a subtle blue variation. Use the source files for the logo itself; use the palette below for layouts, UI, and supporting graphics.', 52, PAGE_H - 119, 9, FONT, SLATE)
    swatch(c, 52, 302, 172, 136, BLUE, 'Koasis Blue', '#0072FB', 'Primary brand / CTA', WHITE)
    swatch(c, 238, 302, 172, 136, BLUE_DEEP, 'Koasis Deep', '#005CFC', 'Accent / emphasis', WHITE)
    swatch(c, 424, 302, 172, 136, INK, 'Koasis Ink', '#102A43', 'Headings / dark UI', WHITE)
    swatch(c, 610, 302, 180, 136, MIST, 'Sky Mist', '#E7F2FF', 'Soft panel / hover', INK)
    swatch(c, 52, 136, 172, 136, PALE, 'Cloud', '#F4F9FF', 'Page background', INK)
    swatch(c, 238, 136, 172, 136, SLATE, 'Slate', '#5B6B7A', 'Body copy / metadata', WHITE)
    swatch(c, 424, 136, 172, 136, WHITE, 'White', '#FFFFFF', 'Logo field / contrast', INK)
    card(c, 610, 136, 180, 136, WHITE, LINE)
    kicker(c, 'Ratio', 628, 244)
    draw_text(c, '60%', 628, 208, 25, FONT_BOLD, BLUE_DEEP)
    draw_text(c, 'blue-led surfaces', 628, 189, 8.5, FONT, SLATE)
    draw_text(c, '30%', 700, 208, 25, FONT_BOLD, INK)
    draw_text(c, 'white / cloud', 700, 189, 8.5, FONT, SLATE)
    draw_text(c, '10%', 628, 160, 25, FONT_BOLD, SLATE)
    draw_text(c, 'ink / slate', 628, 141, 8.5, FONT, SLATE)
    draw_text(c, 'Use contrast first. The blue should feel intentional, not noisy.', 52, 96, 9, FONT_BOLD, INK)
    footer(c, 5)


def draw_typography(c: canvas.Canvas) -> None:
    c.setFillColor(C(PALE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Typography', 'Keep the logo custom; keep supporting communication clean and accessible.')
    card(c, 52, 255, 446, 235, WHITE)
    kicker(c, '01 / Wordmark', 76, 460)
    draw_text(c, 'Custom locked artwork', 76, 423, 22, FONT_BOLD, INK)
    paragraph(c, 'The Koasis wordmark is not a typeset name. It includes custom letterforms, spacing, a speech-bubble detail inside the a, and a dedicated tagline. Always place the supplied PNG artwork.', 76, 393, 360, 10, 15, FONT, SLATE)
    image(c, WORDMARK_PATH, 76, 278, 344, 100)
    card(c, 522, 255, 268, 235, INK)
    kicker(c, '02 / Supporting type', 546, 460)
    draw_text(c, 'Noto Sans', 546, 422, 25, FONT_BOLD, WHITE)
    draw_text(c, 'Modern, open, easy to scan.', 546, 396, 10, FONT, '#D8E8F8')
    line(c, 546, 376, 760, 376, '#35516E', 0.7)
    draw_text(c, 'Heading / Bold', 546, 349, 9, FONT_BOLD, '#7FC6FF')
    draw_text(c, 'Body / Regular', 657, 349, 9, FONT, '#D8E8F8')
    draw_text(c, '0123456789', 546, 318, 17, FONT_BOLD, WHITE)
    draw_text(c, 'Aa Bb Cc  /  Clear clinical communication', 546, 291, 9, FONT, '#D8E8F8')
    card(c, 52, 83, 738, 132, WHITE, LINE)
    kicker(c, 'Recommended hierarchy', 76, 190)
    rows = [('H1', '32 / 38 pt', 'Page titles and primary statements'),
            ('H2', '18 / 24 pt', 'Section headings and card titles'),
            ('Body', '10.5 / 16 pt', 'Explanatory copy and UI content'),
            ('Meta', '8 / 12 pt', 'Labels, captions, file notes')]
    x = 76
    for label, spec, use in rows:
        draw_text(c, label, x, 155, 9, FONT_BOLD, BLUE_DEEP)
        draw_text(c, spec, x, 137, 8.5, FONT, SLATE)
        draw_text(c, use, x, 120, 8.5, FONT, INK)
        x += 174
    footer(c, 6)


def draw_backgrounds(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Backgrounds and contrast', 'Protect recognition by giving the mark a quiet, intentional field.')
    panels = [(52, 270, 232, 198, WHITE, 'Preferred', 'White field', True),
              (304, 270, 232, 198, PALE, 'Preferred', 'Cloud field', True),
              (556, 270, 234, 198, '#D9EEFF', 'Use with care', 'Tinted field', True)]
    for x, y, w, h, fill, label, desc, good in panels:
        card(c, x, y, w, h, fill, LINE if fill == WHITE else None)
        image(c, WORDMARK_PATH, x + 20, y + 92, w - 40, 82)
        checkmark(c, x + 20, y + 34, good)
        draw_text(c, label, x + 36, y + 31, 9, FONT_BOLD, INK)
        draw_text(c, desc, x + 36, y + 16, 8, FONT, SLATE)
    card(c, 52, 83, 738, 142, INK)
    kicker(c, 'Do not improvise a reverse logo', 76, 201)
    draw_text(c, 'Avoid placing the blue logo on equally saturated blue or busy imagery.', 76, 171, 15, FONT_BOLD, WHITE)
    paragraph(c, 'If a dark or photographic background is unavoidable, create an approved reversed master first. Never recolor the supplied artwork with filters, shadows, outlines, or opacity tricks.', 76, 147, 590, 10, 15, FONT, '#D8E8F8')
    checkmark(c, 716, 156, False)
    footer(c, 7)


def draw_misuse(c: canvas.Canvas) -> None:
    c.setFillColor(C(PALE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Logo misuse', 'Consistency is a trust signal. Avoid changes that weaken recognition.')
    items = [
        ('Do not stretch', 'Keep the original aspect ratio.', 'stretch'),
        ('Do not recolor', 'Use the approved blue artwork.', 'recolor'),
        ('Do not rotate', 'The gesture and K-like angle are fixed.', 'rotate'),
        ('Do not add effects', 'No shadow, outline, glow, or bevel.', 'shadow'),
        ('Do not crop', 'Keep the full silhouette visible.', 'crop'),
        ('Do not rebuild', 'Do not retype or alter the wordmark.', 'rebuild'),
    ]
    positions = [(52, 278), (303, 278), (554, 278), (52, 92), (303, 92), (554, 92)]
    for (title, desc, kind), (x, y) in zip(items, positions):
        card(c, x, y, 234, 145, WHITE, LINE)
        if kind == 'stretch':
            image(c, ICON_PATH, x + 24, y + 53, 150, 58)
        elif kind == 'recolor':
            c.saveState()
            c.setFillColor(C('#9AA5B1'))
            c.roundRect(x + 37, y + 58, 64, 48, 9, fill=1, stroke=0)
            c.restoreState()
        elif kind == 'rotate':
            c.saveState()
            c.translate(x + 82, y + 82)
            c.rotate(18)
            image(c, ICON_PATH, -35, -35, 70, 70)
            c.restoreState()
        elif kind == 'shadow':
            c.saveState()
            c.setFillColor(C('#B5C0CC'))
            c.roundRect(x + 38, y + 53, 68, 52, 12, fill=1, stroke=0)
            c.restoreState()
            image(c, ICON_PATH, x + 30, y + 62, 68, 68)
        elif kind == 'crop':
            c.saveState()
            c.clipPath(c.beginPath()) if False else None
            image(c, ICON_PATH, x + 12, y + 49, 90, 90)
            c.setFillColor(C(WHITE))
            c.rect(x + 12, y + 49, 24, 90, fill=1, stroke=0)
            c.restoreState()
        else:
            image(c, WORDMARK_PATH, x + 17, y + 69, 197, 57)
            line(c, x + 28, y + 57, x + 201, y + 57, RED, 1.2)
        checkmark(c, x + 20, y + 24, False)
        draw_text(c, title, x + 36, y + 21, 9, FONT_BOLD, INK)
        draw_text(c, desc, x + 36, y + 8, 7.5, FONT, SLATE)
    footer(c, 8)


def draw_applications(c: canvas.Canvas) -> None:
    c.setFillColor(C(WHITE))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_title(c, 'Application principles', 'Choose the smallest mark that still communicates the brand clearly.')
    card(c, 52, 250, 226, 235, PALE)
    kicker(c, 'Digital identity', 76, 458)
    c.setFillColor(C(WHITE))
    c.roundRect(76, 326, 178, 91, 14, fill=1, stroke=0)
    image(c, ICON_PATH, 118, 337, 58, 58)
    draw_text(c, 'App / favicon', 76, 299, 10, FONT_BOLD, INK)
    paragraph(c, 'Use icon-only at small sizes. Keep the mark centered with generous padding.', 76, 283, 170, 8.5, 12, FONT, SLATE)
    card(c, 306, 250, 226, 235, WHITE, LINE)
    kicker(c, 'Header / deck', 330, 458)
    c.setFillColor(C(PALE))
    c.roundRect(330, 326, 178, 91, 14, fill=1, stroke=0)
    image(c, WORDMARK_PATH, 340, 357, 158, 46)
    draw_text(c, 'Website / presentation', 330, 299, 10, FONT_BOLD, INK)
    paragraph(c, 'Use the full lockup when the audience needs name, promise, and recognition in one glance.', 330, 283, 170, 8.5, 12, FONT, SLATE)
    card(c, 560, 250, 230, 235, INK)
    kicker(c, 'Document / print', 584, 458)
    c.setFillColor(C(WHITE))
    c.roundRect(584, 326, 182, 91, 14, fill=1, stroke=0)
    image(c, WORDMARK_PATH, 596, 357, 158, 46)
    draw_text(c, 'Letterhead / report', 584, 299, 10, FONT_BOLD, WHITE)
    paragraph(c, 'Place the logo in a quiet header or footer, never inside dense body copy.', 584, 283, 175, 8.5, 12, FONT, '#D8E8F8')
    card(c, 52, 83, 738, 132, WHITE, LINE)
    kicker(c, 'Placement checklist', 76, 190)
    checks = ['Use the source PNG at original proportions.', 'Keep clear space around the full lockup.', 'Use icon-only below the full-lockup minimum.', 'Check contrast before publishing or printing.']
    y = 155
    for item in checks:
        checkmark(c, 82, y + 2, True)
        draw_text(c, item, 98, y, 9, FONT, INK)
        y -= 22
    footer(c, 9)


def draw_handoff(c: canvas.Canvas) -> None:
    c.setFillColor(C(INK))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    kicker(c, 'Koasis / Source of truth', 52, PAGE_H - 42)
    draw_text(c, 'Asset handoff', 52, PAGE_H - 80, 29, FONT_BOLD, WHITE)
    paragraph(c, 'Use these final files as the approved starting point for product, marketing, clinical documents, and partner materials.', 52, PAGE_H - 96, 510, 10, 15, FONT, '#D8E8F8')
    card(c, 52, 250, 450, 168, WHITE)
    kicker(c, 'Approved assets', 76, 392)
    assets = [
        ('Koasis Logo Final.png', '512 x 512 px / RGBA / icon only'),
        ('Koasis Wordmark Final.png', '1803 x 522 px / RGBA / icon + wordmark + tagline'),
        ('koasis-favicon-transparent.png', '512 x 512 px / RGBA / favicon export'),
        ('koasis-logo-wordmark-transparent.png', '1803 x 522 px / RGBA / transparent lockup'),
    ]
    y = 363
    for name, spec in assets:
        draw_text(c, name, 76, y, 8.5, FONT_BOLD, INK)
        draw_text(c, spec, 76, y - 14, 8, FONT, SLATE)
        y -= 31
    card(c, 530, 250, 260, 168, '#18385B')
    image(c, ICON_PATH, 615, 280, 90, 90)
    draw_text(c, 'Your Clinical Oasis', 660, 265, 10, FONT_BOLD, WHITE, 'center')
    draw_text(c, 'Blue-led. Human-centered.', 660, 248, 8, FONT, '#D8E8F8', 'center')
    kicker(c, 'Production notes', 52, 206)
    paragraph(c, 'Digital: keep exports in sRGB with transparency. Print: place the original artwork in the layout and convert only at final production stage if a CMYK workflow requires it. Do not recreate the logo from editable text.', 52, 187, 600, 10, 15, FONT, '#D8E8F8')
    draw_text(c, 'KOASIS  /  BRAND GUIDELINES  /  1.0', 52, 34, 7.5, FONT, '#9CCBFF')
    draw_text(c, '10', PAGE_W - 52, 34, 7.5, FONT_BOLD, '#9CCBFF', 'right')


def build() -> None:
    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT_PDF), pagesize=landscape(A4), pageCompression=1)
    c.setTitle('Koasis Brand Guidelines')
    c.setAuthor('Koasis')
    draw_cover(c); c.showPage()
    draw_foundation(c); c.showPage()
    draw_logo_system(c); c.showPage()
    draw_clearspace(c); c.showPage()
    draw_colors(c); c.showPage()
    draw_typography(c); c.showPage()
    draw_backgrounds(c); c.showPage()
    draw_misuse(c); c.showPage()
    draw_applications(c); c.showPage()
    draw_handoff(c); c.showPage()
    c.save()


if __name__ == '__main__':
    build()
    print(OUT_PDF)
