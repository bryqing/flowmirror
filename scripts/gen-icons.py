"""
FlowMirror PWA 图标生成脚本
生成与 public/icon.svg 一致的 PNG 图标：
  - icon-192.png / icon-512.png （any）
  - icon-maskable-192.png / icon-maskable-512.png （maskable，核心内容缩进安全区）
不依赖 cairosvg，直接用 Pillow 程序化绘制，保证渐变/光晕可控。
用法：python scripts/gen-icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parent.parent / "public"

# 品牌色（与 globals.css / icon.svg 保持一致）
BG_TOP = (20, 20, 25)        # #141419
BG_BOTTOM = (9, 9, 11)       # #09090b
ICE = (103, 232, 249)        # #67e8f9 深度工作 冰青
INDIGO = (165, 180, 252)     # #a5b4fc 日常杂务 靛蓝
ROSE = (251, 113, 133)       # #fb7185 娱乐黑洞 警示玫瑰
CORE = (9, 9, 11)            # 镜面核心深色


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial_bg(size):
    """垂直渐变背景（近似 radialGradient 顶部亮底部暗）"""
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        # 顶部偏亮、底部偏暗，略带上凸曲线
        c = lerp(BG_TOP, BG_BOTTOM, min(1.0, t * 1.35))
        d.line([(0, y), (size, y)], fill=c)
    return img


def ring_gradient(size, angle_deg):
    """
    生成一条沿圆环的线性渐变（冰青 -> 靛蓝）并旋转 angle_deg。
    返回 (ring_img, ring_mask)。
    """
    s = size
    grad = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(grad)
    for x in range(s):
        t = x / (s - 1)
        c = lerp(ICE, INDIGO, t)
        d.line([(x, 0), (x, s)], fill=c)
    return grad.rotate(angle_deg, resample=Image.BICUBIC)


def draw_icon(size, maskable=False):
    img = radial_bg(size)
    d = ImageDraw.Draw(img, "RGBA")

    # 安全区缩放（maskable 需把核心图形缩进，避免被系统裁剪）
    scale = 0.72 if maskable else 1.0
    cx = size / 2
    cy = size / 2

    # 圆角外框（仅非 maskable；maskable 铺满全幅背景）
    if not maskable:
        rr = int(size * 0.218)  # 112/512
        d.rounded_rectangle(
            [size * 0.031, size * 0.031, size * 0.969, size * 0.969],
            radius=rr,
            fill=None,
            outline=(255, 255, 255, 23),
            width=max(2, size // 256),
        )

    # 轨道环（冰青->靛蓝渐变，旋转 -24°）
    ring_r = size * 0.25 * scale      # 128/512
    ring_w = max(6, int(size * 0.0273 * scale))  # 14/512
    ring = ring_gradient(size, -24)
    ring_mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(ring_mask)
    md.ellipse(
        [cx - ring_r - ring_w, cy - ring_r - ring_w, cx + ring_r + ring_w, cy + ring_r + ring_w],
        fill=255,
    )
    md.ellipse(
        [cx - ring_r + ring_w, cy - ring_r + ring_w, cx + ring_r - ring_w, cy + ring_r - ring_w],
        fill=0,
    )
    # 圆环轻微透明
    ring_alpha = ring_mask.point(lambda p: int(p * 0.9))
    img.paste(ring, (0, 0), ring_alpha)

    # 黑洞警示点（带光晕）
    dot_r = size * 0.03125 * scale    # 16/512
    dot_cx = cx + size * 0.1875 * scale   # 352-256=96 -> 96/512=0.1875
    dot_cy = cy - size * 0.15625 * scale  # 256-176=80 -> 80/512=0.15625
    _draw_glow_circle(d, img, (dot_cx, dot_cy), dot_r, ROSE, size)

    # 镜面核心（深色圆 + 冰青描边 + 光晕）
    core_r = size * 0.121 * scale      # 62/512
    _draw_glow_circle(d, img, (cx, cy), core_r, ICE, size, ring_color=(103, 232, 249, 255), ring_w=max(5, int(size * 0.0195 * scale)))
    # 核心实心深色
    d.ellipse(
        [cx - core_r, cy - core_r, cx + core_r, cy + core_r],
        fill=CORE + (255,),
    )
    # 中心冰青小圆
    inner_r = size * 0.043 * scale     # 22/512
    d.ellipse(
        [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r],
        fill=ICE + (255,),
    )

    return img


def _draw_glow_circle(draw, img, center, r, color, size, ring_color=None, ring_w=0):
    """绘制带外发光的小圆点/圆环"""
    cx, cy = center
    # 光晕：单独图层做高斯模糊
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    glow_r = int(r * 1.8)
    gd.ellipse(
        [cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r],
        fill=color + (140,),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.9))
    img.paste(glow, (0, 0), glow)

    if ring_color:
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=None,
            outline=ring_color,
            width=ring_w,
        )
    else:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (255,))


def main():
    PUBLIC.mkdir(exist_ok=True)
    outputs = {
        "icon-192.png": (192, False),
        "icon-512.png": (512, False),
        "icon-maskable-192.png": (192, True),
        "icon-maskable-512.png": (512, True),
    }
    for name, (size, maskable) in outputs.items():
        img = draw_icon(size, maskable)
        img.save(PUBLIC / name, "PNG", optimize=True)
        print(f"✓ {name} ({size}x{size})")


if __name__ == "__main__":
    main()
