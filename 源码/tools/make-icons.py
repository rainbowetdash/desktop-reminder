#!/usr/bin/env python3
"""生成「桌面提醒」的全部图标（浅色圆角底 + 蓝色圆形对勾）。
用法：python3 源码/tools/make-icons.py   需要 Pillow（pip3 install pillow）和 macOS 的 iconutil。
输出到 源码/app/assets/：icon.png / icon.icns / icon.ico / tray.png / trayTemplate.png / trayTemplate@2x.png
"""
import os, subprocess, shutil, tempfile
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'app', 'assets'))
BLUE = (61, 75, 209, 255)
BG = (243, 244, 248, 255)
EDGE = (217, 220, 232, 255)
SS = 2  # 先按 2 倍大小画，再缩小，边缘更平滑
S = 1024 * SS

def check_points(cx, cy, r):
    # 对勾三个点，相对圆心、半径的比例（和候选图 C 一致）
    k = r / 27.0
    return [(cx + (x - 50) * k, cy + (y - 50) * k) for x, y in ((38, 51), (47, 60), (63, 41))], 7 * k

def draw_check(d, pts, w, fill):
    d.line(pts, fill=fill, width=int(w), joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=fill)

def app_icon():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    m, rad = 100 * SS, 185 * SS
    box = (m, m, S - m, S - m)
    # 柔和投影
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((box[0], box[1] + 14 * SS, box[2], box[3] + 14 * SS), rad, fill=(20, 24, 50, 70))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18 * SS)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, rad, fill=BG, outline=EDGE, width=3 * SS)
    cx = cy = S / 2
    r = 242 * SS
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=BLUE)
    pts, w = check_points(cx, cy, r)
    draw_check(d, pts, w, (255, 255, 255, 255))
    return img

def tray_icon(size, template):
    n = size * 16  # 16 倍超采样
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = n / 2
    r = n * 0.46
    if template:
        # macOS 菜单栏模板图：纯黑 + 透明，系统会自动适配深浅色
        d.ellipse((c - r, c - r, c + r, c + r), fill=(0, 0, 0, 255))
        pts, w = check_points(c, c, r)
        mask = Image.new('L', (n, n), 0)
        md = ImageDraw.Draw(mask)
        draw_check(md, pts, w * 1.15, 255)
        a = img.split()[3]
        a = Image.composite(Image.new('L', (n, n), 0), a, mask)
        img.putalpha(a)
    else:
        d.ellipse((c - r, c - r, c + r, c + r), fill=BLUE)
        pts, w = check_points(c, c, r)
        draw_check(d, pts, w * 1.1, (255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)

def main():
    big = app_icon()
    full = big.resize((1024, 1024), Image.LANCZOS)
    full.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))
    # icns
    tmp = tempfile.mkdtemp()
    iset = os.path.join(tmp, 'icon.iconset')
    os.makedirs(iset)
    for base in (16, 32, 128, 256, 512):
        full.resize((base, base), Image.LANCZOS).save(os.path.join(iset, f'icon_{base}x{base}.png'))
        full.resize((base * 2, base * 2), Image.LANCZOS).save(os.path.join(iset, f'icon_{base}x{base}@2x.png'))
    subprocess.check_call(['iconutil', '-c', 'icns', iset, '-o', os.path.join(OUT, 'icon.icns')])
    shutil.rmtree(tmp)
    # ico（Windows）：去掉外围透明边距，让图标在小尺寸下更大
    body = full.crop((70, 70, 954, 954))
    body.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    tray_icon(32, False).save(os.path.join(OUT, 'tray.png'))
    tray_icon(18, True).save(os.path.join(OUT, 'trayTemplate.png'))
    tray_icon(36, True).save(os.path.join(OUT, 'trayTemplate@2x.png'))
    print('done ->', OUT)

if __name__ == '__main__':
    main()
