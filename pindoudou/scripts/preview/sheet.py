# -*- coding: utf-8 -*-
"""
把 style-lab.cjs 出的角色图拼成一张总览预览（中文排版交给 Pillow + 系统字体）

为什么用 Python 而不是在 Node 里画字：
    自己写 TrueType 解析只为了排两行标题不划算；Pillow 已经在工作区里，
    msyhbd.ttc（微软雅黑粗体）也随系统有，直接用它更稳。

用法： python scripts/preview/sheet.py [--out out/style-preview.png]
"""
import argparse
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CREAM = (249, 244, 234)
INK = (27, 27, 31)
MUTED = (139, 139, 147)
CARD = (255, 255, 255)
LINE = (233, 234, 238)

# 和 style-lab.cjs 里那套小装饰件同色，保持两张图是一套视觉
ORANGE = (221, 122, 51)
TEAL = (29, 143, 163)
PINK = (241, 169, 196)
GREEN = (127, 166, 83)
RED = (196, 69, 58)
YELLOW = (242, 194, 48)
PLUM = (142, 90, 128)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise SystemExit("找不到可用的中文字体（msyhbd.ttc / msyh.ttc / simhei.ttf）")


def rounded_card(base, box, radius, bg=CARD, shadow=True):
    """白色圆角卡 + 柔和投影"""
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(sh)
        x0, y0, x1, y1 = box
        d.rounded_rectangle((x0 + 3, y0 + 10, x1 + 3, y1 + 14), radius, fill=(24, 24, 28, 26))
        d.rounded_rectangle((x0, y0 + 6, x1, y1 + 10), radius, fill=(24, 24, 28, 20))
        base.alpha_composite(sh)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius, fill=bg)
    return base


def flower(d, cx, cy, r, color, petals=6):
    """六瓣小花：和角色图里的装饰件同一套画法"""
    for k in range(petals):
        import math
        a = k / petals * math.tau - math.pi / 2
        px, py = cx + math.cos(a) * r * 0.62, cy + math.sin(a) * r * 0.62
        pr = r * 0.62
        d.ellipse((px - pr, py - pr, px + pr, py + pr), fill=color)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "out", "style-preview.png"))
    ap.add_argument("--dir", default=os.path.join(HERE, "out"))
    a = ap.parse_args()

    files = {
        "cat": os.path.join(a.dir, "style-cat.png"),
        "elephant": os.path.join(a.dir, "style-elephant.png"),
    }
    for f in files.values():
        if not os.path.exists(f):
            raise SystemExit(f"缺少角色图：{f}（先跑 node scripts/preview/style-lab.cjs）")

    W, H = 1310, 940
    base = Image.new("RGBA", (W, H), CREAM + (255,))
    d = ImageDraw.Draw(base)

    # 四周撒一把小装饰件（和角色图里那套一致，让整张图看起来是一版贴纸）。
    # 位置要避开标题与说明文字，否则会互相压。
    flower(d, 700, 96, 24, ORANGE)
    flower(d, 1252, 150, 20, YELLOW)
    flower(d, 1160, 856, 20, PLUM)
    flower(d, 300, 888, 16, PLUM)
    d.ellipse((1244, 640, 1268, 664), fill=RED)
    d.ellipse((1206, 676, 1224, 694), fill=RED)
    d.ellipse((940, 82, 958, 100), fill=TEAL)
    d.ellipse((966, 108, 978, 120), fill=TEAL)
    d.line((884, 92, 916, 112, 884, 132), fill=GREEN, width=9, joint="curve")
    d.line((60, 856, 92, 874, 66, 894), fill=TEAL, width=9, joint="curve")
    d.line((1180, 800, 1216, 782, 1230, 806), fill=PINK, width=9, joint="curve")

    title = load_font(48)
    sub = load_font(23)
    cap = load_font(30)
    meta = load_font(21)

    d.text((60, 50), "素材库风格试画 · 01 / 02", font=title, fill=INK)
    d.text((62, 116), "无描边平涂 · 奶白底 · 高饱和哑光色 · 手作轮廓（头大身小，五官夸张）",
           font=sub, fill=MUTED)

    cards = [
        (60, files["cat"], "黑猫 · 头顶苹果", "参考图第 4 行的黑猫"),
        (690, files["elephant"], "蓝象 · 头顶香蕉帽", "参考图第 3 行的蓝象"),
    ]

    img_size = 500
    top = 186
    for x, path, name, note in cards:
        rounded_card(base, (x, top, x + img_size, top + img_size), 30)
        img = Image.open(path).convert("RGBA").resize((img_size, img_size), Image.LANCZOS)
        # 卡内再切一次圆角，让角色图跟着卡片走
        mask = Image.new("L", (img_size, img_size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, img_size - 1, img_size - 1), 22, fill=255)
        base.paste(img, (x, top), mask)
        d.text((x, top + img_size + 24), name, font=cap, fill=INK)
        d.text((x + 2, top + img_size + 66), note, font=meta, fill=MUTED)

    d.text((60, 824), "两张都是脚本绘制矢量图元再栅格化的产物，不是文生图。先确认风格，再决定要不要下沉到素材流水线。",
           font=meta, fill=MUTED)
    d.text((60, 862), "600 × 600 · 单张 < 40 KB · 生成脚本 scripts/preview/style-lab.cjs",
           font=meta, fill=(154, 154, 162))

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    base.convert("RGB").save(a.out, "PNG", optimize=True)
    print(f"{os.path.relpath(a.out, os.getcwd())}  {os.path.getsize(a.out)} 字节  {W}x{H}")


if __name__ == "__main__":
    main()
