# -*- coding: utf-8 -*-
"""
还原度评测用的测试图（开发用，不进构建产物）。

为什么需要这批图：引擎的取样 / 量化 / 映射任何一步改动都可能「这张变好、那张变差」，
没有固定的评测集合就只能靠感觉，最后很容易把某个场景调坏。
覆盖拼豆最典型的六种题材（也都是历史上踩过坑的场景）：
  1. photo_pumpkin  真实照片（橘色南瓜，白底 + 高饱和主体 + 反光/投影）
  2. synth_fruit    高清版同题材：白底上带高光与投影的饱和橙色球体 + 绿梗
  3. synth_portrait 暖色人脸（肤色渐变最怕量化成灰）
  4. synth_sky      蓝色天空 + 云（曾经被硬映射成暖色，是最坏用例）
  5. synth_forest   绿色森林（大面积近似色，考验过渡色取舍）
  6. synth_product  白底商品（米白/浅灰底最怕落到浅彩色上）

用法：python scripts/fidelity/fixtures-gen.py
输出：scripts/fidelity/fixtures/*.png
"""

import math
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
os.makedirs(OUT, exist_ok=True)


def save(name, arr):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    img.save(os.path.join(OUT, name))
    print(f'{name:22s} {img.size[0]}x{img.size[1]}')


def radial(px, py, cx, cy):
    return np.sqrt((px - cx) ** 2 + (py - cy) ** 2)


def synth_fruit(size=512):
    """白底 + 立体橙色果实：主体是连续的明暗渐变，最容易看出「量化后发灰」。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    cx, cy, r = size * 0.5, size * 0.58, size * 0.3
    d = radial(x, y, cx, cy) / r

    img = np.zeros((size, size, 3), np.float64)
    img[:, :] = [246, 244, 240]

    shadow = np.exp(-(((x - cx) / (r * 1.25)) ** 2 + ((y - (cy + r * 0.92)) / (r * 0.22)) ** 2))
    img -= shadow[:, :, None] * np.array([26, 30, 34])

    body = d <= 1.0
    nz = np.sqrt(np.clip(1 - d ** 2, 0, 1))
    light = np.clip(0.42 + 0.68 * (-(x - cx) / r * 0.55 - (y - cy) / r * 0.62 + nz * 0.92), 0, 1.35)
    base = np.array([244, 122, 40])
    shade = np.array([118, 48, 14])
    t = np.clip(light, 0, 1)[:, :, None]
    ball = shade + (base - shade) * t
    spec = np.exp(-(((x - (cx - r * 0.34)) / (r * 0.2)) ** 2 + ((y - (cy - r * 0.36)) / (r * 0.26)) ** 2))
    ball += spec[:, :, None] * np.array([110, 105, 95])
    img[body] = ball[body]

    stem = (np.abs(x - cx) < r * 0.07) & (y > cy - r * 1.5) & (y < cy - r * 0.55)
    img[stem] = np.array([104, 132, 48])

    rng = np.random.default_rng(7)
    img += rng.normal(0, 2.4, img.shape)
    save('synth_fruit.png', img)


def synth_portrait(size=512):
    """暖色人脸：肤色 + 头发 + 蓝色背景，考验肤色是否被量化偏色。"""
    img = np.zeros((size, size, 3), np.float64)
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    img[:, :, 0] = 150 + 40 * (y / size)
    img[:, :, 1] = 175 + 30 * (y / size)
    img[:, :, 2] = 205 + 20 * (y / size)

    face = ((x - size * 0.5) / (size * 0.23)) ** 2 + ((y - size * 0.54) / (size * 0.3)) ** 2 <= 1
    shade = 1 - 0.35 * np.clip(((x - size * 0.5) / (size * 0.23)), 0, 1) - 0.2 * np.clip((y - size * 0.54) / (size * 0.3), 0, 1)
    skin = np.stack([244 * shade + 6, 198 * shade + 10, 168 * shade + 12], axis=-1)
    img[face] = skin[face]

    hair = (((x - size * 0.5) / (size * 0.27)) ** 2 + ((y - size * 0.36) / (size * 0.24)) ** 2 <= 1) & (y < size * 0.5)
    img[hair] = np.array([74, 52, 42])

    for ex in (0.42, 0.58):
        eye = ((x - size * ex) / (size * 0.035)) ** 2 + ((y - size * 0.52) / (size * 0.022)) ** 2 <= 1
        img[eye] = np.array([48, 40, 38])
    mouth = ((x - size * 0.5) / (size * 0.075)) ** 2 + ((y - size * 0.68) / (size * 0.03)) ** 2 <= 1
    img[mouth] = np.array([176, 86, 84])

    rng = np.random.default_rng(11)
    img += rng.normal(0, 2.0, img.shape)
    save('synth_portrait.png', img)


def synth_sky(size=512):
    """蓝色天空 + 云：最常见、也最容易被「暖色板」毁掉的题材。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    t = y / size
    img = np.zeros((size, size, 3), np.float64)
    img[:, :, 0] = 96 + 150 * t - 40 * np.sin(x / size * math.pi)
    img[:, :, 1] = 150 + 90 * t
    img[:, :, 2] = 214 + 30 * t

    cloud = np.zeros((size, size), np.float64)
    for (cx, cy, rx, ry, a) in [
        (0.28, 0.62, 0.20, 0.075, 0.95),
        (0.42, 0.60, 0.17, 0.095, 0.9),
        (0.58, 0.66, 0.22, 0.08, 0.85),
        (0.74, 0.58, 0.15, 0.07, 0.7),
        (0.5, 0.78, 0.34, 0.05, 0.5),
    ]:
        cloud = np.maximum(cloud, a * np.exp(-(((x / size - cx) / rx) ** 2 + ((y / size - cy) / ry) ** 2)))
    img = img * (1 - cloud[:, :, None]) + np.array([252, 252, 253]) * cloud[:, :, None]

    crown = ((x - size * 0.85) / (size * 0.3)) ** 2 + ((y - size * 1.02) / (size * 0.22)) ** 2 <= 1
    img[crown] = np.array([62, 104, 58])
    rng = np.random.default_rng(3)
    img += rng.normal(0, 1.8, img.shape)
    save('synth_sky.png', img)


def synth_forest(size=512):
    """绿色森林：大面积近似色，考验「过渡色取舍」，很容易一片糊成同色。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    img = np.zeros((size, size, 3), np.float64)
    img[:, :, 0] = 40 + 60 * (1 - y / size)
    img[:, :, 1] = 70 + 90 * (1 - y / size)
    img[:, :, 2] = 42 + 40 * (1 - y / size)

    rng = np.random.default_rng(5)
    for i in range(70):
        cx, cy = rng.uniform(0, size), rng.uniform(0, size * 0.92)
        rr = rng.uniform(size * 0.04, size * 0.13)
        d = radial(x, y, cx, cy) / rr
        blob = d <= 1
        tone = np.array([rng.uniform(24, 96), rng.uniform(78, 158), rng.uniform(30, 74)])
        img[blob] = 0.55 * img[blob] + 0.45 * tone
    glow = np.exp(-(((x - size * 0.72) / (size * 0.3)) ** 2 + ((y - 0) / (size * 0.5)) ** 2))
    img += glow[:, :, None] * np.array([120, 110, 60])
    rng = np.random.default_rng(9)
    img += rng.normal(0, 2.2, img.shape)
    save('synth_forest.png', img)


def synth_product(size=512):
    """白底商品照：米白/浅灰底 + 彩色主体 + 柔和阴影。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    img = np.full((size, size, 3), 250.0)
    img[:, :, 1] -= 2 * (y / size)
    img[:, :, 2] -= 4 * (y / size)

    shadow = np.exp(-(((x - size * 0.5) / (size * 0.3)) ** 2 + ((y - size * 0.8) / (size * 0.05)) ** 2))
    img -= shadow[:, :, None] * np.array([34, 40, 48])

    box = (np.abs(x - size * 0.5) < size * 0.2) & (y > size * 0.34) & (y < size * 0.78)
    depth = np.clip((y - size * 0.34) / (size * 0.44), 0, 1)[:, :, None]
    img[box] = np.array([52, 118, 176]) * (1.0 - 0.35 * depth[box]) + np.array([18, 40, 60]) * 0.35 * depth[box]
    top = np.abs(x - size * 0.5) < size * 0.2
    lid = top & (np.abs(y - size * 0.34) < size * 0.035)
    img[lid] = np.array([226, 88, 62])
    rng = np.random.default_rng(13)
    img += rng.normal(0, 1.6, img.shape)
    save('synth_product.png', img)


def synth_flat_cartoon(size=512):
    """扁平卡通（硬边缘 + 大面积纯色）：模拟素材库里的 SVG 风格图案。
    用来兜住「越优化越糊」—— 平滑缩放在这里最容易把硬边磨成渐变。"""
    img = np.full((size, size, 3), 252.0)
    yy, xx = np.mgrid[0:size, 0:size]
    body = ((xx - size * 0.5) / (size * 0.26)) ** 2 + ((yy - size * 0.56) / (size * 0.3)) ** 2 <= 1
    img[body] = np.array([244, 150, 62])
    ear = (((xx - size * 0.32) / (size * 0.09)) ** 2 + ((yy - size * 0.26) / (size * 0.11)) ** 2 <= 1) | \
          (((xx - size * 0.68) / (size * 0.09)) ** 2 + ((yy - size * 0.26) / (size * 0.11)) ** 2 <= 1)
    img[ear] = np.array([244, 150, 62])
    eye = (((xx - size * 0.42) / (size * 0.03)) ** 2 + ((yy - size * 0.52) / (size * 0.025)) ** 2 <= 1) | \
          (((xx - size * 0.58) / (size * 0.03)) ** 2 + ((yy - size * 0.52) / (size * 0.025)) ** 2 <= 1)
    img[eye] = np.array([46, 42, 40])
    nose = ((xx - size * 0.5) / (size * 0.028)) ** 2 + ((yy - size * 0.62) / (size * 0.022)) ** 2 <= 1
    img[nose] = np.array([198, 70, 62])
    scarf = (np.abs(yy - size * 0.72) < size * 0.035) & (np.abs(xx - size * 0.5) < size * 0.24)
    img[scarf] = np.array([58, 122, 178])
    # 2px 高光条，专门用来测细节保留
    img[(np.abs(yy - size * 0.44) < 2) & (np.abs(xx - size * 0.42) < size * 0.06)] = np.array([255, 214, 170])
    save('synth_flat_cartoon.png', img)


def photo_pumpkin():
    """真实照片（从创作页截图里裁出，去掉界面覆盖层）。"""
    src = (r'C:\Users\sharyuke\.dsh\attachments\v1\objects\86'
           r'\8628ef7a24d1d42306b18e60b2143604a0cbc56e9a383b49099612f0c3ce4cfa')
    if not os.path.exists(src):
        print('跳过 photo_pumpkin：原始截图不在本机')
        return
    im = Image.open(src).convert('RGB')
    k = im.size[0] / 1540.0
    # 只取缩略图里的照片本身：右边是卡片留白，右上角是界面按钮，都要剪掉
    box = (int(136 * k), int(92 * k), int(232 * k), int(196 * k))
    crop = im.crop(box)
    crop = crop.filter(ImageFilter.GaussianBlur(0.3))
    crop.save(os.path.join(OUT, 'photo_pumpkin.png'))
    print(f'{"photo_pumpkin.png":22s} {crop.size[0]}x{crop.size[1]}')


if __name__ == '__main__':
    synth_fruit()
    synth_portrait()
    synth_sky()
    synth_forest()
    synth_product()
    synth_flat_cartoon()
    photo_pumpkin()
