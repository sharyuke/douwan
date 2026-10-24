# -*- coding: utf-8 -*-
"""把「原图 / 改前 / 改后」拼成一张对照图，便于人工确认改动是否真的更接近原图。

用法：python scripts/fidelity/make-compare.py
输出：scripts/fidelity/out/compare-before-after.png
"""

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
RENDERS = os.path.join(OUT, 'renders')
FIXTURES = os.path.join(HERE, 'fixtures')

# (原图, 改前, 改后, 标题)
ROWS = [
    ('photo_pumpkin', 'before/photo_pumpkin__easy-13-free48.png', 'after/photo_pumpkin__easy-13-mard.png', '真实照片：橘色南瓜 · 好拼版'),
    ('synth_fruit', 'before/synth_fruit__easy-13-free48.png', 'after/synth_fruit__easy-13-mard.png', '白底主体：橙色果实 · 好拼版'),
    ('synth_sky', 'before/synth_sky__easy-13-free48.png', 'after/synth_sky__easy-13-mard.png', '蓝色天空 + 云 · 好拼版'),
]

CELL = 300
PAD = 14
LABEL_H = 34


def font(size):
    for path in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit(img, size):
    img = img.convert('RGB')
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), 'white')
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def main():
    f_head = font(19)
    f_cell = font(16)
    cols = ['原图', '改前：旧算法 + 48 色精简色板', '改后：新算法 + 漫德全色号 221']
    W = PAD + (CELL + PAD) * 3
    H = PAD + LABEL_H * len(ROWS) + (CELL + PAD) * len(ROWS) + LABEL_H

    sheet = Image.new('RGB', (W, H), '#F4F4F2')
    draw = ImageDraw.Draw(sheet)

    # 顶部表头
    for i, text in enumerate(cols):
        draw.text((PAD + i * (CELL + PAD) + 6, 8), text, fill='#1B1B1F', font=f_head)

    y = LABEL_H
    for src_name, before_rel, after_rel, title in ROWS:
        draw.text((PAD, y + 6), title, fill='#5B5B63', font=f_cell)
        y += LABEL_H
        cells = [
            fit(Image.open(os.path.join(FIXTURES, src_name + '.png')), CELL),
            fit(Image.open(os.path.join(RENDERS, before_rel)), CELL),
            fit(Image.open(os.path.join(RENDERS, after_rel)), CELL),
        ]
        for i, cell in enumerate(cells):
            x = PAD + i * (CELL + PAD)
            sheet.paste(cell, (x, y))
            draw.rectangle([x - 1, y - 1, x + CELL, y + CELL], outline='#D8D8D4')
        y += CELL + PAD

    path = os.path.join(OUT, 'compare-before-after.png')
    sheet.save(path)
    print('saved', path, sheet.size)


if __name__ == '__main__':
    main()
