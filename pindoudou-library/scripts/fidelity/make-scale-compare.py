# -*- coding: utf-8 -*-
"""把「同一张原图在不同画布尺寸下的图纸」拼成一张对照图，用来回答
「精细档到底有没有用、什么情况下有用」。

数字直接读 bench-scale.mjs 的输出（out/scale-*.json），不手写 ——
否则图和数字会各说各话。

用法：
  node scripts/fidelity/bench-scale.mjs --image <原图> --grids 116,300,450 --colors 30 --label scale-girl
  python scripts/fidelity/make-scale-compare.py
输出：docs/canvas-fidelity-compare.png
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

# (行标题, 原图路径, bench 的 label, 该行想说明什么)
ROWS = [
    ('真人照片：1337 × 1755（信息量足够）', os.path.join(OUT, 'photo-src', 'ref_girl.png'), 'scale-girl',
     '格数直接决定五官与衣服褶皱能不能留下'),
    ('小图：155 × 168（原图本身就没有更多信息）', os.path.join(HERE, 'fixtures', 'photo_pumpkin.png'), 'scale-pumpkin',
     '原图分辨率不够时，加大画布只是插值'),
]

GRIDS = [116, 300, 450]
COL_TITLES = {
    116: '116 × 116（旧上限 = 4×4 块）',
    300: '300 × 300（精细档，Pro）',
    450: '450 × 450（超大档，Pro）',
}

CELL = 330
PAD = 14
HEAD_H = 46
ROW_TITLE_H = 30
COL_LABEL_H = 30


def font(size, bold=False):
    paths = ([r'C:\Windows\Fonts\msyhbd.ttc'] if bold else []) + [
        r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']
    for path in paths:
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


def metrics(label, grid):
    path = os.path.join(OUT, label + '.json')
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    for row in data.get('rows', []):
        if row.get('grid') == grid:
            return row
    return None


def main():
    f_head = font(20, True)
    f_col = font(15)
    f_row = font(17, True)
    f_num = font(14)
    f_note = font(13)

    cols = 1 + len(GRIDS)
    W = PAD + (CELL + PAD) * cols
    H = HEAD_H + sum(ROW_TITLE_H + COL_LABEL_H + CELL + PAD for _ in ROWS) + 34

    sheet = Image.new('RGB', (W, H), '#F4F4F2')
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD, 12), '同一张图 · 不同画布尺寸（豆玩 DOUWAN，好拼版 / 30 色上限 / 漫德 221 色板）',
              fill='#1B1B1F', font=f_head)

    y = HEAD_H
    for title, src_path, label, note in ROWS:
        draw.text((PAD, y + 4), title, fill='#1B1B1F', font=f_row)
        y += ROW_TITLE_H

        headers = ['原图'] + [COL_TITLES[g] for g in GRIDS]
        for i, text in enumerate(headers):
            draw.text((PAD + i * (CELL + PAD) + 4, y + 6), text, fill='#5B5B63', font=f_col)
        y += COL_LABEL_H

        cells = [fit(Image.open(src_path), CELL)]
        subs = ['']
        for g in GRIDS:
            path = os.path.join(OUT, label, 'g%d_c30.png' % g)
            cells.append(fit(Image.open(path), CELL))
            row = metrics(label, g)
            subs.append('远看色差 %.2f · 每格色差 %.2f · %d 色' % (row['dEview'], row['dEcell'], row['usedColors'])
                        if row else '')

        for i, cell in enumerate(cells):
            x = PAD + i * (CELL + PAD)
            sheet.paste(cell, (x, y))
            draw.rectangle([x - 1, y - 1, x + CELL, y + CELL], outline='#D8D8D4')
            if subs[i]:
                draw.text((x + 4, y + CELL + 4), subs[i], fill='#83838B', font=f_num)

        y += CELL + PAD
        draw.text((PAD, y - 6), note, fill='#B4690E', font=f_note)
        y += 14

    out_path = os.path.join(REPO, 'docs', 'canvas-fidelity-compare.png')
    sheet.save(out_path)
    print('saved', out_path, sheet.size)


if __name__ == '__main__':
    main()
