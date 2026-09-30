"""Draws the Cuajo app icon (an Ace of Coins card on green felt) as PNG files, no image libraries needed."""
import math, struct, zlib, os, sys

def png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

def hexc(s): s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
FELT, FELT_D = hexc('1f4d40'), hexc('12352a')
IVORY, IVORY2, INK = hexc('fbf7ee'), hexc('efe5cf'), hexc('2a2118')
GOLD, RED, BLUE = hexc('f0c63f'), hexc('d4392f'), hexc('4c8ccc')

def star(cx, cy, ro, ri, n=5):
    pts = []
    for i in range(n * 2):
        a = -math.pi / 2 + i * math.pi / n
        r = ro if i % 2 == 0 else ri
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def inside(px, py, poly):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1: c = not c
    return c

def rrect_d(px, py, cx, cy, hw, hh, r):   # signed distance to a rounded rectangle
    qx, qy = abs(px - cx) - (hw - r), abs(py - cy) - (hh - r)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def render(S, full_bleed=True):
    img = bytearray(S * S * 4)
    u = S / 100.0
    cx = cy = S / 2
    card_hw, card_hh, card_r = 23 * u, 32 * u, 3.2 * u
    coin_r, ring_r, red_r = 15.5 * u, 12.2 * u, 7.6 * u
    st = star(cx, cy, 6.4 * u, 2.7 * u)
    ss = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]
    for y in range(S):
        for x in range(S):
            acc = [0.0, 0.0, 0.0]
            for ox, oy in ss:
                px, py = x + ox, y + oy
                d0 = math.hypot(px - cx, py - cy * 0.9) / (S * 0.75)
                col = tuple(FELT[i] * (1 - d0) + FELT_D[i] * d0 for i in range(3))
                # shadow under the card
                if rrect_d(px, py - 1.2 * u, cx + 1.0 * u, cy, card_hw, card_hh, card_r) < 1.4 * u:
                    col = tuple(c * 0.62 for c in col)
                dc = rrect_d(px, py, cx, cy, card_hw, card_hh, card_r)
                if dc < 0:
                    t = (py - (cy - card_hh)) / (2 * card_hh)
                    col = tuple(IVORY[i] * (1 - t) + IVORY2[i] * t for i in range(3))
                    if -0.9 * u < rrect_d(px, py, cx, cy, card_hw - 2.6 * u, card_hh - 2.6 * u, 1.2 * u) < 0: col = INK   # inner frame (coins: no breaks)
                    dr = math.hypot(px - cx, py - cy)
                    if dr < coin_r + 0.9 * u: col = INK
                    if dr < coin_r: col = GOLD
                    if ring_r - 0.45 * u < dr < ring_r + 0.45 * u and int((math.atan2(py - cy, px - cx) + math.pi) / (math.pi / 18)) % 2 == 0: col = INK
                    if dr < red_r + 0.6 * u: col = INK
                    if dr < red_r: col = RED
                    if inside(px, py, st): col = GOLD
                    if dr < 1.3 * u: col = BLUE
                    if dc > -0.7 * u: col = INK   # card edge
                acc = [acc[i] + col[i] for i in range(3)]
            o = (y * S + x) * 4
            img[o:o + 4] = bytes([int(acc[0] / 4), int(acc[1] / 4), int(acc[2] / 4), 255])
    return img

out = sys.argv[1]
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')]:
    png(os.path.join(out, name), size, size, render(size))
    print('wrote', name)
