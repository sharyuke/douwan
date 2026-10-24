# -*- coding: utf-8 -*-
"""
「自动抠背景」精度评测用的**带真值掩膜**测试图（开发用，不进构建产物）。

为什么需要这批图：抠背景（src/lib/matte.js）的产物是 0~1 的 α 图 + 「这一格放不放豆」，
没有真值就只能靠肉眼看“好像抠得还行”。这批图每张都配一张灰度 mask PNG
（255 = 主体，0 = 背景，中间值 = 软边缘覆盖率），于是 IoU / 边界 F1 / 覆盖率 MAE
这些指标才成立，改算法时才能判断是“真变好”还是“换个地方翻车”。

设计原则：
  1. **确定性**：噪声一律用固定种子的 numpy RandomState，同一份代码在任何机器上
     生成同一张图（没有任何随机时钟 / 哈希序依赖）；
  2. **抗锯齿真值**：所有边缘都用「面积覆盖率」当 α，图像用同一个 α 与背景合成。
     于是 mask = 255*α 不只是“看起来对”，它就是这张图真正的合成系数，
     软边缘图的 α 真值因此是严格可比的（而不是先画图再手工描边）；
  3. **每张图针对一类真实翻车场景**（见下）。

覆盖的场景：
  1. cut_circle_white    纯白底 + 实心橙圆        —— 最基准的单色背景抠图
  2. cut_twotone_card    白底 + 浅黄圆角卡片      —— 双色背景（本站内置素材那类“白边+卡片底色”）
  3. cut_gradient_bg     纵向渐变浅蓝→浅绿 + 描边 —— 背景不是纯色，考验自适应容差
  4. cut_noise_bg        草地噪点背景             —— 外圈离散度极大，考验簇内离散度进容差
  5. cut_white_on_white  白底 + 白色雪人(有黑描边) —— 专门考「颜色像背景但被描边隔开的主体不能被吃」
  6. cut_soft_edge       深灰蓝底 + 6px 羽化橙圆  —— 专门考软边缘的 α 覆盖率准不准
  7. photo_pumpkin       真实照片（已有，无真值）  —— 只做定性检查

用法：python scripts/fidelity/fixtures-gen-cut.py [名字...]
输出：scripts/fidelity/fixtures/cut_*.png 与 cut_*.mask.png
"""

import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
os.makedirs(OUT, exist_ok=True)

SS = 4  # 抗锯齿超采样倍率：每像素 4x4 子采样 → α 步进 1/16，足够当“真值”


def save_cut(name, rgb, mask01):
    """存图 + 存真值掩膜。mask01 是 0~1 的面积覆盖率（浮点）。"""
    img = Image.fromarray(np.clip(rgb + 0.5, 0, 255).astype(np.uint8), 'RGB')
    msk = Image.fromarray(np.clip(mask01 * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    img.save(os.path.join(OUT, f'cut_{name}.png'))
    msk.save(os.path.join(OUT, f'cut_{name}.mask.png'))
    print(f'{"cut_" + name:24s} {img.size[0]:4d}x{img.size[1]:<4d} subject={mask01.mean():.3f}'
          f'  soft={(np.mean((mask01 > 0.02) & (mask01 < 0.98)) * 100):.2f}%')


def supersample(shape, fn):
    """fn(x, y) 返回布尔数组；在 SS×SS 子网格上求平均得到 0~1 覆盖率。

    坐标口径：像素 (i,j) 覆盖 [i,i+1)×[j,j+1)，子采样点取格心。
    它和解析式圆（cmask）在 1 像素过渡带上是同一件事，只是更通用。
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    acc = np.zeros((h, w), np.float64)
    for sy in range(SS):
        y = yy + (sy + 0.5) / SS
        for sx in range(SS):
            x = xx + (sx + 0.5) / SS
            acc += fn(x, y).astype(np.float64)
    return acc / (SS * SS)


def cover(obj, bg, sub):
    """按覆盖率把主体色合成到背景色上；返回 (图像, 覆盖率的浮点掩膜)。"""
    a = sub[..., None]
    return obj * a + bg * (1 - a), sub


def cmask(shape, cx, cy, r):
    """圆的覆盖率：distance<r-0.5 → 1，>r+0.5 → 0，之间线性。

    这是题目指定的真值口径（把像素中心到圆心的距离当采样点，过渡带正好 1 像素宽），
    等价于理想抗锯齿圆。用解析式而不是超采样，是为了让真值本身没有方法论偏差。
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    return np.clip((r + 0.5) - d, 0.0, 1.0)


def tri_inside(x, y, p1, p2, p3):
    """点是否在三角形内（重心符号法，边界算内）。p* 是 (x, y)。"""
    def cross(ax, ay, bx, by, px, py):
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    d1 = cross(p1[0], p1[1], p2[0], p2[1], x, y)
    d2 = cross(p2[0], p2[1], p3[0], p3[1], x, y)
    d3 = cross(p3[0], p3[1], p1[0], p1[1], x, y)
    neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
    pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
    return ~(neg & pos)


def rounded_rect_mask(shape, x0, y0, x1, y1, rad):
    """圆角矩形的覆盖率（4x4 超采样）。x0..x1 / y0..y1 是矩形外边界。"""
    def inside(x, y):
        qx = np.maximum(np.maximum(x0 - x, x - x1), 0.0)
        qy = np.maximum(np.maximum(y0 - y, y - y1), 0.0)
        return np.sqrt(qx ** 2 + qy ** 2) <= rad
    return supersample(shape, inside)


# --------------------------------------------------------------------- 1

def circle_white(size=600):
    """纯白底 + 居中实心橙圆（半径 200，抗锯齿边缘）。

    最基准的用例：背景是单一纯白，外圈聚类只该有一个簇。
    如果这张都抠不准，说明是流程性问题而不是场景性问题。
    """
    bg = np.array([255.0, 255.0, 255.0])
    fg = np.array([237.0, 124.0, 46.0])
    a = cmask((size, size), size / 2, size / 2, 200.0)
    rgb, mask = cover(fg, bg, a)
    save_cut('circle_white', rgb, mask)


# --------------------------------------------------------------------- 2

def twotone_card(size=512):
    """白底 + 浅黄圆角矩形卡片，卡片内放一个青绿色主体（圆 + 三角组合）。

    模拟本站内置素材的“白边 + 卡片底色”双色背景：
    外圈只有白，但背景其实还有一大块浅黄 —— 背景模型必须能把浅黄也收进来，
    同时**不能**把卡片里的青绿色主体一起收掉。三角用来考尖角。
    """
    bg = np.full((size, size, 3), 255.0)
    card = np.array([250.0, 244.0, 208.0])
    subj = np.array([42.0, 168.0, 152.0])

    a_card = rounded_rect_mask((size, size), size * 0.10, size * 0.10, size * 0.90, size * 0.90, 48)
    img = card * a_card[..., None] + bg * (1 - a_card[..., None])

    a_circle = cmask((size, size), size * 0.40, size * 0.50, size * 0.17)
    p1 = (size * 0.64, size * 0.34)
    p2 = (size * 0.84, size * 0.66)
    p3 = (size * 0.48, size * 0.70)
    a_tri = supersample((size, size), lambda x, y: tri_inside(x, y, p1, p2, p3))

    a_sub = np.clip(np.maximum(a_circle, a_tri), 0, 1)
    img = subj * a_sub[..., None] + img * (1 - a_sub[..., None])
    save_cut('twotone_card', img, a_sub)


# --------------------------------------------------------------------- 3

def gradient_bg(size=600):
    """纵向渐变背景（浅蓝→浅绿）+ 带深色描边的红色圆角矩形主体。

    背景每行颜色都不同，但变化是连续的 —— 正确的做法是让容差盖住渐变，
    而不是把渐变下半段判成主体；描边则用来考“主体轮廓不能被当成背景吃掉”。
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    t = yy / (size - 1)
    top = np.array([214.0, 232.0, 246.0])
    bot = np.array([208.0, 240.0, 214.0])
    img = top[None, None, :] * (1 - t[..., None]) + bot[None, None, :] * t[..., None]

    body = np.array([206.0, 62.0, 54.0])
    edge = np.array([46.0, 38.0, 40.0])
    a_edge = rounded_rect_mask((size, size), size * 0.24, size * 0.28, size * 0.76, size * 0.72, 34)
    a_body = rounded_rect_mask((size, size), size * 0.26, size * 0.30, size * 0.74, size * 0.70, 28)

    img = edge * a_edge[..., None] + img * (1 - a_edge[..., None])
    img = body * a_body[..., None] + img * (1 - a_body[..., None])
    save_cut('gradient_bg', img, a_edge)


# --------------------------------------------------------------------- 4

def noise_bg(size=512):
    """草地状噪点背景（多个绿色基色 + 高斯噪声）+ 中间一个棕色不规则团块主体。

    外圈颜色极散（同一块草地上有十几档绿），簇内离散度会很大。
    这里最容易出的问题是「容差被离散度撑得过大 → 把主体也吞了」，
    所以主体特意选与所有绿色基色都拉得很开的棕色（ΔE00 很大）。
    """
    rng = np.random.RandomState(20240612)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)

    # 低频起伏：几个高斯团，固定参数
    low = np.zeros((size, size))
    for (cx, cy, rr, amp) in [(0.20, 0.30, 0.35, 1.0), (0.75, 0.20, 0.30, 0.8),
                              (0.50, 0.85, 0.40, 0.9), (0.90, 0.70, 0.28, 0.7)]:
        low += amp * np.exp(-(((xx / size - cx) ** 2 + (yy / size - cy) ** 2) / (rr ** 2)))
    low = (low - low.min()) / max(1e-6, float(np.max(low) - np.min(low)))

    grass = np.zeros((size, size, 3))
    dark = np.array([44.0, 84.0, 38.0])
    base = np.array([86.0, 132.0, 58.0])
    light = np.array([138.0, 178.0, 82.0])
    for k, col in enumerate([dark, base, light]):
        w = np.clip(1.0 - np.abs(low * 2.0 - k), 0, 1)[..., None]
        grass += col * w

    # 中频草簇：若干随机椭圆压暗 / 提亮（位置来自固定种子）
    for _ in range(60):
        cx = rng.uniform(0, size)
        cy = rng.uniform(0, size)
        rr = rng.uniform(size * 0.02, size * 0.07)
        f = rng.uniform(-0.28, 0.28)
        e = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (rr ** 2)))
        grass += e[..., None] * f * np.array([60.0, 70.0, 40.0])

    grass += rng.normal(0, 9.0, grass.shape)  # 高斯噪声，固定种子
    img = grass

    # 主体：不规则棕色团块（低频高斯场的水平集，天然是不规则闭合形状）
    field = np.zeros((size, size))
    for _ in range(9):
        cx = rng.uniform(size * 0.28, size * 0.72)
        cy = rng.uniform(size * 0.28, size * 0.72)
        rr = rng.uniform(size * 0.10, size * 0.20)
        amp = rng.uniform(0.6, 1.0)
        field += amp * np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (rr ** 2)))
    field = field / max(1e-6, float(np.max(field)))

    subj_dark = np.array([92.0, 58.0, 32.0])
    subj_light = np.array([150.0, 106.0, 62.0])

    # 双线性插值采样（关键：点采样会让边缘完全没有中间覆盖率 → 掩膜失去抗锯齿）
    def sample_field(x, y):
        xc = np.clip(x, 0, size - 1)
        yc = np.clip(y, 0, size - 1)
        x0 = np.floor(xc).astype(int)
        y0 = np.floor(yc).astype(int)
        x1 = np.minimum(x0 + 1, size - 1)
        y1 = np.minimum(y0 + 1, size - 1)
        fx = xc - x0
        fy = yc - y0
        v00 = field[y0, x0]
        v10 = field[y0, x1]
        v01 = field[y1, x0]
        v11 = field[y1, x1]
        return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy

    a_blob = supersample((size, size), lambda x, y: sample_field(x, y) > 0.52)
    inner = np.clip((field - 0.52) / 0.30, 0, 1)[..., None]
    blob_rgb = subj_dark * (1 - inner * 0.55) + subj_light * (inner * 0.55)

    img = blob_rgb * a_blob[..., None] + img * (1 - a_blob[..., None])
    save_cut('noise_bg', img, a_blob)


# --------------------------------------------------------------------- 5

def white_on_white(size=512):
    """白底 + **白色**主体（雪人：两个白圆 + 黑描边 + 深色眼睛/鼻子）。

    专门考一件事：主体的填充色和白底在颜色上**完全一样**（254,254,253 vs 255,255,255），
    唯一把它和背景分开的是那圈描边。洪水填充如果允许跨过强边缘，
    主体的白色就会被从边缘“渗”进去吃掉 —— 这张图就是用来兜住这个 bug 的。
    真值把描边和五官一并算作主体（它们是画上去的线条，不是背景）。
    """
    bg = np.array([255.0, 255.0, 255.0])
    white = np.array([254.0, 254.0, 253.0])
    line = np.array([38.0, 38.0, 42.0])
    carrot = np.array([232.0, 138.0, 46.0])

    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    hx, hy, r_head = size * 0.50, size * 0.30, size * 0.135
    bx, by, r_body = size * 0.50, size * 0.635, size * 0.215
    d_head = np.sqrt((xx - hx) ** 2 + (yy - hy) ** 2)
    d_body = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)

    a_head = np.clip((r_head + 0.5) - d_head, 0, 1)
    a_body = np.clip((r_body + 0.5) - d_body, 0, 1)
    a_snow = np.clip(np.maximum(a_head, a_body), 0, 1)

    # 描边 = 轮廓外 4px 环带（覆盖率的差集，天然抗锯齿）
    a_stroke = np.clip(np.maximum(
        np.clip((r_head + 4.5) - d_head, 0, 1) - np.clip((r_head - 3.5) - d_head, 0, 1),
        np.clip((r_body + 4.5) - d_body, 0, 1) - np.clip((r_body - 3.5) - d_body, 0, 1),
    ), 0, 1)

    img = white * a_snow[..., None] + bg * (1 - a_snow[..., None])
    img = line * a_stroke[..., None] + img * (1 - a_stroke[..., None])

    # 眼睛 + 嘴：一列深色小圆点
    a_dark = np.zeros((size, size))
    for (cx, cy, r) in [(0.452, 0.262, 0.021), (0.548, 0.262, 0.021), (0.50, 0.318, 0.022),
                        (0.432, 0.400, 0.020), (0.50, 0.425, 0.020), (0.568, 0.400, 0.020)]:
        a_dark = np.maximum(a_dark, cmask((size, size), size * cx, size * cy, size * r))

    # 鼻子：朝右的等腰三角（尖点在 x=0.62）
    a_nose = supersample((size, size), lambda x, y: tri_inside(
        x, y,
        (size * 0.470, size * 0.296), (size * 0.470, size * 0.344), (size * 0.620, size * 0.320)))

    img = carrot * a_nose[..., None] + img * (1 - a_nose[..., None])
    img = line * a_dark[..., None] + img * (1 - a_dark[..., None])

    mask = np.clip(np.maximum(np.maximum(a_snow, a_stroke), np.maximum(a_dark, a_nose)), 0, 1)
    save_cut('white_on_white', img, mask)


# --------------------------------------------------------------------- 6

def soft_edge(size=384, feather=6.0):
    """深灰蓝底 + 边缘 6 像素线性羽化的橙色圆（真值 mask 用同样的羽化）。

    其它图考的是“位置对不对”，这张考“覆盖率数值准不准”：
    α 真值有一个 6px 宽的线性带，matte 的三区软抠图能不能把中间值算对，
    就看这张的 α MAE / IoU —— 硬边算法会把整条带推成 0 或 1。
    """
    bg = np.array([56.0, 64.0, 82.0])
    fg = np.array([232.0, 140.0, 58.0])
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    d = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2)
    r = size * 0.32
    a = np.clip((r + feather / 2) - d, 0, feather) / feather
    rgb, mask = cover(fg, bg, a)
    save_cut('soft_edge', rgb, mask)


# --------------------------------------------------------------------- 7

def srgb_to_linear(c):
    """sRGB(0~1) → 线性光。阴影是「直射光被挡掉」，只在线性空间里才是乘法。"""
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def ellipse_falloff(shape, cx, cy, rx, ry, power=1.4, core=0.5):
    """归一化椭圆内的平滑衰减：核心（r ≤ core）为 1，边缘（core < r < 1）衰减到 0。

    坐标 cx/cy/rx/ry 都是相对边长的比例。

    为什么要有 **平坦的核心**：真实的投影不是"中心一个点最黑、向四周线性变淡"，
    而是一整块接近全黑的**本影**，外面一圈半影过渡到亮背景。
    只有点状衰减的话，真正暗到"能看出是阴影"的像素会少得可怜 ——
    那样的测试图根本考不出算法（实测确实如此：点状衰减时 ΔE00>12 的像素只占 0.5%）。
    core 越小平影越宽（柔和接地影），越接近 1 边界越利（硬边投影）。
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    r = np.sqrt(((xx - cx * w) / (rx * w)) ** 2 + ((yy - cy * h) / (ry * h)) ** 2)
    t = np.clip((1.0 - r) / max(1e-6, 1.0 - core), 0.0, 1.0)
    return t ** power


def apply_shadow(bg_rgb, strength, k):
    """按遮挡比例 s 把背景压暗：线性空间逐通道乘 (1 - s·(1-k))。

    k 是阴影里保留的光照比例（逐通道、略偏蓝 —— 环境光比直射光冷）。
    这是投影的物理模型（直射光被遮住、只剩环境光），不是随手调暗：
    背景色再乘同一个系数，所以「色相不变、只变暗」正是阴影的可识别特征。
    """
    lin = srgb_to_linear(bg_rgb / 255.0)
    mult = 1.0 - strength[..., None] * (1.0 - np.asarray(k)[None, None, :])
    return linear_to_srgb(lin * mult) * 255.0


def _shadow_scene(name, size, bg_rgb, obj_rgb, obj_box, shadow_parts, k, power, core=0.5):
    """纯色背景 + 圆角矩形产品 + 接地影/投影。parts 为 (cx, cy, rx, ry, amp)。

    obj_box 给的是产品**最终**的外接矩形（x0,y0,x1,y1，比例）与圆角半径 rad：
    rounded_rect_mask 的 x0..x1 是圆角前的矩形边、rad 会再向外扩一圈，
    所以这里把 rad 先内缩回去，产品才真的落在给定框里 —— 否则阴影会被主体整个盖住。

    真值 mask **只含产品本身，不含阴影** —— 这正是产品图抠图想要的：
    不要背景、不要影子，只留一个干净的物体。
    """
    s = np.zeros((size, size), np.float64)
    for (cx, cy, rx, ry, amp) in shadow_parts:
        s = np.maximum(s, amp * ellipse_falloff((size, size), cx, cy, rx, ry, power, core))
    ground = apply_shadow(np.full((size, size, 3), bg_rgb, np.float64), s, k)

    x0, y0, x1, y1, rad = obj_box
    a_obj = rounded_rect_mask(
        (size, size),
        (x0 + rad) * size, (y0 + rad) * size,
        (x1 - rad) * size, (y1 - rad) * size,
        rad * size,
    )
    img = obj_rgb * a_obj[..., None] + ground * (1 - a_obj[..., None])
    save_cut(name, img, a_obj)


def shadow_soft(size=512):
    """中灰摄影棚底 + 立着的圆角矩形产品 + 向右下铺开的柔和接地影与投影。

    考的是最常见也最难的电商产品图：主体本身很好抠，但那团**和主体连在一起**的
    阴影会被当成主体留下来，拼出来就是「物体 + 一圈灰豆」。
    阴影是乘法模型（逐通道、偏蓝），与背景只差亮度不差色相；
    主体特意放在左上、阴影铺到右下，保证阴影的深色本影是**露在外面**的
    （被主体挡住的那部分根本考不出算法）。
    """
    _shadow_scene(
        'shadow_soft', size,
        bg_rgb=np.array([206.0, 204.0, 199.0]),
        obj_rgb=np.array([46.0, 158.0, 143.0]),
        obj_box=(0.24, 0.14, 0.48, 0.58, 0.05),
        shadow_parts=[
            (0.370, 0.600, 0.160, 0.055, 0.98),  # 接地影：最黑，紧贴物体底部
            (0.630, 0.680, 0.300, 0.115, 0.92),  # 侧向投影：更大更淡
        ],
        k=(0.40, 0.43, 0.52),
        power=1.4,
        core=0.55,
    )


def shadow_hard(size=512):
    """浅蓝底 + 同款产品 + 边缘明显更利的斜向投影（core 大 = 半影窄）。

    上一张考「柔和接地影」，这张考「边界清晰得多的投影」：本影是一整块接近全黑的
    平台，外面只剩一圈很窄的半影。底色也换成浅蓝 ——
    阴影判定必须对彩色背景同样成立，而不是只对灰白底有效。
    """
    _shadow_scene(
        'shadow_hard', size,
        bg_rgb=np.array([214.0, 228.0, 240.0]),
        obj_rgb=np.array([222.0, 84.0, 62.0]),
        obj_box=(0.26, 0.14, 0.48, 0.54, 0.045),
        shadow_parts=[
            (0.370, 0.552, 0.150, 0.060, 0.98),
            (0.640, 0.640, 0.280, 0.130, 0.95),
        ],
        k=(0.30, 0.34, 0.44),
        power=2.2,
        core=0.62,
    )


# --------------------------------------------------------------------- 9

def gray_on_white(size=512):
    """白底 + 无描边的中灰主体（圆 + 方块），考「别把『灰』当成阴影」。

    中灰物体与白底只差亮度：白乘一个常数就得到灰，这和阴影的乘法模型完全一样。
    颜色上无法区分，唯一可靠的信号是**边缘**：物体轮廓是硬边（1 像素抗锯齿），
    阴影的衰减是渐变的。这张图就是用来兜住「浅色物体被当成阴影整个吃掉」的风险，
    所以它没有黑描边、也没有任何可以挡住洪水填充的强轮廓。
    """
    bg = np.array([255.0, 255.0, 255.0])
    obj = np.array([196.0, 196.0, 198.0])

    a_circle = cmask((size, size), size * 0.40, size * 0.50, size * 0.20)
    a_box = rounded_rect_mask((size, size), size * 0.56, size * 0.34, size * 0.82, size * 0.66, 18)
    a_obj = np.clip(np.maximum(a_circle, a_box), 0, 1)

    rgb, mask = cover(obj, bg, a_obj)
    save_cut('gray_on_white', rgb, mask)


FIXTURES = {
    'circle_white': circle_white,
    'twotone_card': twotone_card,
    'gradient_bg': gradient_bg,
    'noise_bg': noise_bg,
    'white_on_white': white_on_white,
    'soft_edge': soft_edge,
    'shadow_soft': shadow_soft,
    'shadow_hard': shadow_hard,
    'gray_on_white': gray_on_white,
}


if __name__ == '__main__':
    names = sys.argv[1:] or list(FIXTURES)
    for nm in names:
        FIXTURES[nm]()
