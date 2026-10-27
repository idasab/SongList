"""Ritar appikonen (samma former som resources/app-icon.svg) som PNG utan alfakanal.

Användning: python resources/render-icon.py 1024 ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png 180 public/apple-touch-icon.png
"""
import math
import struct
import sys
import zlib

GREEN = (0x45, 0x82, 0x68)
WHITE = (0xFF, 0xFF, 0xFF)
RED = (0xA4, 0x5F, 0x66)
SUB = 8  # delrader per pixel (lodrät kantutjämning); vågrätt räknas täckningen exakt


def cubic(p0, p1, p2, p3, n=96):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        pts.append((
            u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
        ))
    return pts


def pick():
    start = (65, 112)
    segs = [
        ((44, 92), (28, 70), (28, 50)),
        ((28, 30), (46, 22), (65, 22)),
        ((84, 22), (102, 30), (102, 50)),
        ((102, 70), (86, 92), (65, 112)),
    ]
    pts = [start]
    cur = start
    for c1, c2, end in segs:
        pts += cubic(cur, c1, c2, end)
        cur = end
    return pts


def rounded_rect(x, y, w, h, r, n=24):
    pts = []
    for cx, cy, a0 in ((x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def coverage(poly, size, scale):
    pts = [(px * scale, py * scale) for px, py in poly]
    edges = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    edges = [(a, b) for a, b in edges if a[1] != b[1]]
    cov = {}
    ys = [p[1] for p in pts]
    for row in range(max(0, int(min(ys))), min(size, int(math.ceil(max(ys))) + 1)):
        line = [0.0] * size
        touched = False
        for s in range(SUB):
            y = row + (s + 0.5) / SUB
            xs = []
            for (x0, y0), (x1, y1) in edges:
                if (y0 <= y < y1) or (y1 <= y < y0):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                xa, xb = max(0.0, xs[i]), min(float(size), xs[i + 1])
                p = int(xa)
                while p < xb and p < size:
                    overlap = min(xb, p + 1) - max(xa, p)
                    if overlap > 0:
                        line[p] += overlap / SUB
                        touched = True
                    p += 1
        if touched:
            cov[row] = line
    return cov


def render(size):
    scale = size / 130
    img = [[list(GREEN) for _ in range(size)] for _ in range(size)]
    layers = [
        (pick(), WHITE),
        (rounded_rect(46, 46, 12, 9, 3), RED),
        (rounded_rect(46, 61, 38, 7, 3.5), GREEN),
    ]
    for poly, color in layers:
        for row, line in coverage(poly, size, scale).items():
            r = img[row]
            for x, c in enumerate(line):
                if c <= 0:
                    continue
                c = min(1.0, c)
                px = r[x]
                for k in range(3):
                    px[k] = px[k] + (color[k] - px[k]) * c
    return img


def write_png(path, img):
    size = len(img)
    raw = bytearray()
    for row in img:
        raw.append(0)
        for px in row:
            raw += bytes(int(round(v)) for v in px)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    # Färgtyp 2 = RGB utan alfakanal (krav för App Store)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    # sRGB-chunk: perceptuell återgivning
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'sRGB', b'\x00') + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


if __name__ == '__main__':
    for size, path in zip(map(int, sys.argv[1::2]), sys.argv[2::2]):
        write_png(path, render(size))
        print(size, path)
