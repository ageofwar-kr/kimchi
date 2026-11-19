#!/usr/bin/env python3
"""김치 v1.0 아이콘/OG 이미지 생성 — 레드 ㄱ 마스코트 (화이트/블랙 모노톤 + 레드 포인트)"""
import os, math
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf"
RED = (229, 57, 53)
WHITE = (255, 255, 255)
INK = (17, 17, 17)
GREY = (110, 110, 115)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)


def rounded_line(draw, pts, width, color, radius=None):
    """꺾인 굵은 선을 둥근 끝/코너로 그린다 (ㄱ 자)."""
    r = width / 2 if radius is None else radius
    draw.line(pts, fill=color, width=width, joint="curve")
    for (x, y) in (pts[0], pts[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def draw_mascot(img, cx, cy, size, body, eye, smile=None):
    """center(cx,cy), 전체 크기 size 로 ㄱ 마스코트를 그린다."""
    d = ImageDraw.Draw(img)
    s = size
    left, top = cx - s / 2, cy - s / 2
    x1 = left + s * 0.16
    x2 = left + s * 0.80
    y1 = top + s * 0.20
    y2 = top + s * 0.86
    w = int(s * 0.215)
    rounded_line(d, [(x1, y1), (x2, y1), (x2, y2)], w, body)
    # 눈
    er = s * 0.050
    for ex in (left + s * 0.365, left + s * 0.615):
        d.ellipse([ex - er, y1 - s * 0.025 - er, ex + er, y1 - s * 0.025 + er], fill=eye)
    # 미소 (작고 둥글게)
    if smile is not None:
        sw = max(3, int(s * 0.020))
        mx = left + s * 0.49
        my = y1 + s * 0.052
        rr = s * 0.042
        d.arc([mx - rr, my - rr, mx + rr, my + rr * 1.6], 200, 340, fill=smile, width=sw)


def icon(path, size, red_bg=True, pad=0.0, radius_ratio=0.235):
    scale = 4
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if red_bg:
        r = int(S * radius_ratio)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=RED)
        draw_mascot(img, S / 2, S / 2 + S * 0.01, S * (1 - pad), WHITE, RED, WHITE)
    else:
        draw_mascot(img, S / 2, S / 2, S * (1 - pad), RED, WHITE, RED)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, "PNG", optimize=True)
    return path


def og(path):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)
    # 왼쪽 레드 ㄱ 마스코트
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_mascot(layer, 250, 315, 330, RED, WHITE, WHITE)
    img.paste(layer, (0, 0), layer)
    # 오른쪽 텍스트
    f_big = ImageFont.truetype(FONT, 128)
    f_mid = ImageFont.truetype(FONT, 44)
    f_small = ImageFont.truetype(FONT, 30)
    d.text((450, 196), "김치", font=f_big, fill=INK)
    d.text((455, 350), "나만의 AI 비서", font=f_mid, fill=INK)
    d.text((455, 414), "오늘 브리핑 · 할 일 정리 · 음성 통화", font=f_small, fill=GREY)
    d.rounded_rectangle([455, 480, 570, 528], radius=24, fill=RED)
    d.text((487, 490), "v1.0", font=ImageFont.truetype(FONT, 26), fill=WHITE)
    d.line([(64, 552), (1136, 552)], fill=(229, 229, 234), width=2)
    d.text((64, 566), "ageofwar-kr.github.io/kimchi", font=ImageFont.truetype(FONT, 22), fill=GREY)
    img.save(path, "PNG", optimize=True)
    return path


if __name__ == "__main__":
    print(icon(os.path.join(OUT, "icon-192.png"), 192, pad=0.06))
    print(icon(os.path.join(OUT, "icon-512.png"), 512, pad=0.06))
    print(icon(os.path.join(OUT, "icon-maskable-512.png"), 512, pad=0.24))
    print(icon(os.path.join(OUT, "apple-touch-icon.png"), 180, red_bg=True, pad=0.06))
    print(og(os.path.join(OUT, "og.png")))
