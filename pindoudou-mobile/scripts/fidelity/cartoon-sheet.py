#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
卡通化对照图（文档用）
-------------------------------------------------------------------------
把「原图 / 卡通（标准档）/ 拼豆图」三列拼成一张图，放到 docs/cartoon-before-after.png，
README 里直接引用。看一眼就知道这个功能到底做了什么，比只贴数字直观。

依赖：上游先用 Node 渲染出卡通图与拼豆图（两者都来自同一份算法代码）：

    node scripts/fidelity/cartoon-bench.mjs --render
    python scripts/fidelity/cartoon-sheet.py

    → docs/cartoon-before-after.png
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(HERE, "fixtures")
RENDERS = os.path.join(HERE, "out", "renders", "cartoon")
OUT = os.path.join(ROOT, "docs", "cartoon-before-after.png")

# 三个题材各代表一类真实场景：真实照片 / 人物 / 密集纹理
CASES = [
    ("photo_pumpkin", "真实照片"),
    ("synth_portrait", "人物"),
    ("synth_forest", "密集纹理"),
]
STYLE = "standard"
PANEL = 232
LABEL_H = 30
GAP = 14
PAD = 16
BG = (244, 245, 247)
INK = (27, 27, 31)
MUTED = (139, 139, 147)
LINE = (233, 234, 238)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit(path, box):
    """等比装进 box×box 的白底方块（拼豆图放大用最近邻，别糊掉格子）"""
    im = Image.open(path).convert("RGB")
    scale = min(box / im.width, box / im.height)
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    resample = Image.NEAREST if size[0] > im.width else Image.LANCZOS
    im = im.resize(size, resample)
    tile = Image.new("RGB", (box, box), (255, 255, 255))
    tile.paste(im, ((box - size[0]) // 2, (box - size[1]) // 2))
    return tile


def main():
    missing = []
    for name, _ in CASES:
        for p in (
            os.path.join(FIXTURES, name + ".png"),
            os.path.join(RENDERS, name + "__" + STYLE + ".png"),
            os.path.join(RENDERS, name + "__" + STYLE + "__pattern.png"),
        ):
            if not os.path.exists(p):
                missing.append(p)
    if missing:
        print("缺少素材，先跑：node scripts/fidelity/cartoon-bench.mjs --render")
        for p in missing:
            print("  -", p)
        return 1

    cols = ["原图（照片）", "卡通形象（标准档）", "拼豆图纸"]
    width = PAD * 2 + PANEL * 3 + GAP * 2
    height = PAD * 2 + LABEL_H + (PANEL + LABEL_H + GAP) * len(CASES) - GAP
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    f_title = load_font(15)
    f_label = load_font(13)
    f_note = load_font(12)

    # 表头
    for c, title in enumerate(cols):
        x = PAD + c * (PANEL + GAP)
        draw.text((x, PAD), title, font=f_title, fill=INK)

    for r, (name, topic) in enumerate(CASES):
        y = PAD + LABEL_H + r * (PANEL + LABEL_H + GAP)
        draw.text((PAD, y), topic, font=f_label, fill=MUTED)
        y += 22
        tiles = [
            os.path.join(FIXTURES, name + ".png"),
            os.path.join(RENDERS, name + "__" + STYLE + ".png"),
            os.path.join(RENDERS, name + "__" + STYLE + "__pattern.png"),
        ]
        for c, path in enumerate(tiles):
            x = PAD + c * (PANEL + GAP)
            sheet.paste(fit(path, PANEL), (x, y))
            draw.rectangle([x - 1, y - 1, x + PANEL, y + PANEL], outline=LINE)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT)
    print("已写出", OUT, sheet.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
