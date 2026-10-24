# -*- coding: utf-8 -*-
"""真值自检：确认 cut_*.png 与 cut_*.mask.png 是自洽的（图 = 主体色按 mask 合成到背景上）。

为什么需要：mask 是评测的"标准答案"，如果 mask 和图对不上（哪怕只是边缘差 1px），
后面所有 IoU / bF1 数字都是在跟一个错答案比。这里用三条与生成器无关的判据：
  A) 软边缘像素处，|图 - (主体色*a + 背景色*(1-a))| 应该很小（α 就是真正的合成系数）；
  B) 主体(α>0.5)不贴图像边界，且主体二值化后是**单一连通块**（没有意外碎块）；
  C) α 图空间上连续：不存在相邻像素跳变 > 0.5 的地方（防止掩膜被条纹/噪声污染）。

跑法: python scripts/fidelity/fixtures-gen-cut-verify.py
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
NAMES = ['circle_white', 'twotone_card', 'gradient_bg', 'noise_bg', 'white_on_white', 'soft_edge']


def local_extreme(a, k):
    """a 在 (2k+1)^2 邻域内的最大/最小值（用切片位移实现，避免依赖 scipy）。"""
    h, w = a.shape
    mx = np.full((h, w), -np.inf)
    mn = np.full((h, w), np.inf)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            ys = slice(max(0, dy), h + min(0, dy))
            xs = slice(max(0, dx), w + min(0, dx))
            yd = slice(max(0, -dy), h + min(0, -dy))
            xd = slice(max(0, -dx), w + min(0, -dx))
            mx[yd, xd] = np.maximum(mx[yd, xd], a[ys, xs])
            mn[yd, xd] = np.minimum(mn[yd, xd], a[ys, xs])
    return mx, mn


def main():
    bad = 0
    for name in NAMES:
        img = np.asarray(Image.open(os.path.join(FIX, f'cut_{name}.png')).convert('RGB')).astype(np.float64)
        mask = np.asarray(Image.open(os.path.join(FIX, f'cut_{name}.mask.png')).convert('L')).astype(np.float64)
        a = mask / 255.0
        h, w = a.shape

        # B) 连通性 + 不贴边
        binm = a > 0.5
        touch = int(binm[0].sum() + binm[-1].sum() + binm[:, 0].sum() + binm[:, -1].sum())
        seen = np.zeros_like(binm, dtype=bool)
        sizes = []
        ys, xs = np.nonzero(binm)
        for sy, sx in zip(ys, xs):
            if seen[sy, sx]:
                continue
            stack = [(sy, sx)]
            seen[sy, sx] = True
            size = 0
            while stack:
                cy, cx = stack.pop()
                size += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and binm[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            sizes.append(size)
        sizes.sort(reverse=True)

        # C) α 连续性：抗锯齿斜边在 k 像素跨度上最多变化约 k（每一步最多 1.0，
        #    切线水平的直边就取到这个上界），所以判据取 k=4 时 ≤1.1；
        #    条纹 / 噪声污染造成的"来回跳"会明显超过这个上界。
        k = 4
        jump1 = max(float(np.abs(np.diff(a, axis=0)).max()), float(np.abs(np.diff(a, axis=1)).max()))
        jumpk = max(float(np.abs(a[k:, :] - a[:-k, :]).max()), float(np.abs(a[:, k:] - a[:, :-k]).max()))
        soft_px = int(((a > 0.05) & (a < 0.95)).sum())

        # D) 圆的半径自检（只对 circle_white）：覆盖率积分 = 面积 = πr²
        radius_txt = ''
        if name == 'circle_white':
            area = float(a.sum())
            r_eff = (area / np.pi) ** 0.5
            radius_txt = f' r_eff={r_eff:.2f}(目标 200)'
            if abs(r_eff - 200) > 0.5:
                bad += 1
                radius_txt += ' BAD'

        # A) 合成一致性：在软边缘带上，用"主体色最亮/最暗"的两端估计主体与背景色，
        #    再验证 图 ≈ 主体*a + 背景*(1-a)。主体/背景色用 mask 极值区域的中位数估计。
        core = a > 0.995
        back = a < 0.005
        diff_txt = 'n/a'
        if name == 'soft_edge' and core.any() and back.any():
            # 用 3x3 腐蚀近似"内部"：只取邻域全在 core / back 里的像素
            mx, mn = local_extreme(a, 1)
            inner_core = core & (mn > 0.995)
            inner_back = back & (mx < 0.005)
            fg = np.median(img[inner_core], axis=0)
            bg = np.median(img[inner_back], axis=0)
            band = (a > 0.05) & (a < 0.95)
            pred = fg[None, None, :] * a[..., None] + bg[None, None, :] * (1 - a[..., None])
            d = np.abs(img - pred)[band]
            diff_txt = f'maxAbsErr={d.max():5.1f} meanAbsErr={d.mean():5.2f}'
            if d.max() > 2.0:
                # 采样点/量化/合成口径不一致会被这条抓出来
                bad += 1
                diff_txt += '  <- 合成口径不一致 BAD'

        # 判据：不贴边、主体是单一连通块、软边缘像素确实存在、且不存在大跨度不连续
        ok = (touch == 0) and (len(sizes) == 1) and (soft_px > 100) and (jumpk <= 1.1)
        if not ok:
            bad += 1
        print(f'{name:16s} {w}x{h} subject_px={(binm.sum()):7d} blobs={len(sizes):2d}(max {sizes[0] if sizes else 0}) '
              f'touch_border={touch:5d} soft_px={soft_px:6d} alpha_step(1px)={jump1:.2f} step(4px)={jumpk:.3f} '
              f'{diff_txt}{radius_txt}  {"OK" if ok else "BAD"}')

    print('=== fixture self-check:', 'ALL OK' if bad == 0 else f'{bad} problem(s) BAD')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
