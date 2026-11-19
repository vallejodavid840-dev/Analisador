"""Corto de anime ORIGINAL: 'La campana de la azotea' (20 s).
Personaje y mundo propios. Técnica estudiada del episodio de referencia:
- animación limitada: dibujo nuevo cada 2-3 cuadros, con pausas largas
- planos cortos, cortes secos, primeros planos de ojos
- fondos pintados oscuros con paralaje, haces de luz
- cuadro de impacto (blanco/negativo), líneas de velocidad, temblor
- cara exagerada tipo chibi para el chiste
"""
import cv2, numpy as np, math, os, subprocess, shutil, random
W, H, FPS = 1280, 720, 24
rng = np.random.RandomState(7)
OUT = '/home/user/Analisador/anime_original'
LINE = (60, 36, 56)                    # contorno BGR
HAIR, HAIR_S = (232, 160, 178), (186, 112, 140)
SKIN, SKIN_S = (196, 222, 252), (160, 188, 232)
HOOD, HOOD_S = (60, 190, 235), (40, 140, 190)
IRIS = (140, 196, 70)

def ease(x): x = min(max(x, 0), 1); return x * x * (3 - 2 * x)
def grad(w, h, top, bot):
    t = np.linspace(0, 1, h)[:, None, None]
    return (np.array(top) * (1 - t) + np.array(bot) * t).repeat(w, 1).astype(np.uint8)
def poly(cv, pts, fill, line=LINE, th=4):
    p = np.array(pts, np.int32)
    if fill is not None: cv2.fillPoly(cv, [p], fill, cv2.LINE_AA)
    if line is not None: cv2.polylines(cv, [p], True, line, th, cv2.LINE_AA)
def ell(cv, c, ax, fill, line=LINE, th=4, ang=0):
    c = (int(c[0]), int(c[1])); ax = (max(int(ax[0]), 1), max(int(ax[1]), 1))
    if fill is not None: cv2.ellipse(cv, c, ax, ang, 0, 360, fill, -1, cv2.LINE_AA)
    if line is not None: cv2.ellipse(cv, c, ax, ang, 0, 360, line, th, cv2.LINE_AA)
def glow(cv, c, r, color, amt):
    layer = np.zeros_like(cv); cv2.circle(layer, (int(c[0]), int(c[1])), int(r), color, -1, cv2.LINE_AA)
    layer = cv2.GaussianBlur(layer, (0, 0), r * 0.6)
    return cv2.add(cv, (layer * amt).astype(np.uint8))
def finish(cv, f, vig=0.55, grain=6):
    h, w = cv.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    v = 1 - vig * np.clip(d - 0.5, 0, 1) ** 1.5
    out = cv.astype(np.float32) * v[..., None]
    out += np.random.RandomState(f).randn(h, w, 1) * grain
    return np.clip(out, 0, 255).astype(np.uint8)

# ---------- fondos (se dibujan una vez) ----------
def skyline(w, h, base, hmin, hmax, color, seed, wins, wcolor, step=(50, 120)):
    r = np.random.RandomState(seed); cv = np.zeros((h, w, 4), np.uint8); x = -20
    while x < w:
        bw = r.randint(*step); bh = r.randint(hmin, hmax)
        cv[base - bh:base + 40, x:x + bw, :3] = color; cv[base - bh:base + 40, x:x + bw, 3] = 255
        if r.rand() < .25:
            cv2.line(cv, (x + bw // 2, base - bh), (x + bw // 2, base - bh - r.randint(30, 80)), (*color, 255), 3)
        if wins:
            for wy in range(base - bh + 18, base - 12, 26):
                for wx in range(x + 10, x + bw - 14, 22):
                    if r.rand() < wins: cv[wy:wy + 11, wx:wx + 9] = (*wcolor, 255)
        x += bw + r.randint(0, 6)
    return cv
def over(bg, layer, ox, oy=0):
    h, w = bg.shape[:2]; lh, lw = layer.shape[:2]
    x0, y0 = max(ox, 0), max(oy, 0); x1, y1 = min(ox + lw, w), min(oy + lh, h)
    if x1 <= x0 or y1 <= y0: return
    s = layer[y0 - oy:y1 - oy, x0 - ox:x1 - ox]; a = s[..., 3:] / 255.
    bg[y0:y1, x0:x1] = (s[..., :3] * a + bg[y0:y1, x0:x1] * (1 - a)).astype(np.uint8)

SKYW = 2200
sky = grad(SKYW, H, (96, 40, 30), (150, 70, 90))
star_r = np.random.RandomState(3)
STARS = [(star_r.randint(0, SKYW), star_r.randint(0, 420), star_r.rand()) for _ in range(160)]
far = skyline(SKYW, H, 560, 90, 230, (96, 62, 62), 11, 0.10, (150, 220, 255), (60, 130))
mid = skyline(SKYW, H, 640, 140, 300, (70, 40, 46), 12, 0.22, (120, 210, 255), (70, 150))
near = skyline(SKYW, H, 760, 190, 420, (42, 24, 32), 13, 0.30, (90, 200, 255), (90, 190))
MOON = (1500, 170)

def city(t, pan0, pan1, dur, f, sky_only=False, push=1.0):
    k = ease(t / dur); pan = pan0 + (pan1 - pan0) * k
    big = sky.copy()
    for (sx, sy, b) in STARS:
        tw = 0.6 + 0.4 * math.sin(f * 0.15 + b * 20)
        cv2.circle(big, (sx, sy), 1 + (b > .8), (int(255 * tw), int(240 * tw), int(220 * tw)), -1)
    big = glow(big, MOON, 120, (190, 230, 255), 0.55)
    cv2.circle(big, MOON, 58, (225, 245, 255), -1, cv2.LINE_AA)
    cv2.circle(big, (MOON[0] - 18, MOON[1] - 10), 14, (205, 228, 240), -1, cv2.LINE_AA)
    cl = np.zeros_like(big)
    for i in range(6):
        cx = (i * 420 + f * (1.2 + i * .15)) % (SKYW + 300) - 150; cy = 230 + (i * 67) % 160
        cv2.ellipse(cl, (int(cx), cy), (210, 26), 0, 0, 360, (150, 90, 110), -1, cv2.LINE_AA)
    cl = cv2.GaussianBlur(cl, (0, 0), 14); big = cv2.addWeighted(big, 1, cl, .5, 0)
    over(big, far, int(-pan * 0.35) + 0, 0) if False else None
    out = big[:, int(pan * 0.15):int(pan * 0.15) + W].copy()
    for lay, par in ((far, .35), (mid, .65), (near, 1.0)):
        over(out, lay[:, int(pan * par):int(pan * par) + W].copy(), 0, 0)
    return out

def room_bg(f):
    bg = grad(W, H, (52, 30, 40), (34, 20, 30))
    cv2.rectangle(bg, (90, 70), (330, 420), (150, 90, 100), -1)               # ventana
    cv2.rectangle(bg, (98, 78), (322, 412), (255, 225, 190), -1)
    for x in (172, 248): cv2.line(bg, (x, 78), (x, 412), (150, 90, 100), 8)
    cv2.line(bg, (98, 245), (322, 245), (150, 90, 100), 8)
    shaft = np.zeros_like(bg)
    cv2.fillPoly(shaft, [np.array([(98, 78), (322, 78), (900, 720), (420, 720)])], (210, 235, 255))
    bg = cv2.addWeighted(bg, 1, shaft, 0.17, 0)
    r = np.random.RandomState(5)
    for i in range(40):                                                        # polvo
        x = (r.randint(120, 800) + f * (0.3 + r.rand() * .4)) % W; y = (r.randint(100, 700) - f * (0.2 + r.rand() * .3)) % H
        cv2.circle(bg, (int(x), int(y)), 2, (240, 250, 255), -1, cv2.LINE_AA)
    return bg

# ---------- personaje: Mika (original) ----------
def face(cv, cx, cy, s, eye_open=1.0, look=(0, 0), sway=0.0, mouth=0.0, blush=0.5):
    S = lambda v: v * s
    # pelo trasero
    ell(cv, (cx, cy - S(10)), (S(290), S(320)), HAIR_S)
    poly(cv, [(cx - S(250), cy), (cx - S(330), cy + S(330) + sway * 8), (cx - S(190), cy + S(380)), (cx - S(150), cy + S(100))], HAIR_S)
    poly(cv, [(cx + S(250), cy), (cx + S(330), cy + S(330) - sway * 8), (cx + S(190), cy + S(380)), (cx + S(150), cy + S(100))], HAIR_S)
    # capucha / hombros
    poly(cv, [(cx - S(330), cy + S(420)), (cx - S(160), cy + S(250)), (cx + S(160), cy + S(250)), (cx + S(330), cy + S(420)),
              (cx + S(330), cy + S(700)), (cx - S(330), cy + S(700))], HOOD)
    poly(cv, [(cx - S(160), cy + S(250)), (cx, cy + S(330)), (cx + S(160), cy + S(250))], HOOD_S)
    # cuello y cara
    poly(cv, [(cx - S(60), cy + S(180)), (cx + S(60), cy + S(180)), (cx + S(70), cy + S(290)), (cx - S(70), cy + S(290))], SKIN_S)
    ell(cv, (cx, cy + S(40)), (S(200), S(240)), SKIN)
    # ojos
    for sg in (-1, 1):
        ex, ey = cx + sg * S(95), cy + S(50)
        if eye_open > 0.18:
            ell(cv, (ex, ey), (S(62), S(74) * eye_open), (250, 250, 250), LINE, 4)
            ix, iy = ex + look[0] * S(14), ey + look[1] * S(12) * eye_open
            ell(cv, (ix, iy), (S(44), S(56) * eye_open), IRIS, LINE, 3)
            ell(cv, (ix, iy), (S(20), S(28) * eye_open), (40, 26, 36), None)
            cv2.circle(cv, (int(ix - S(14)), int(iy - S(20) * eye_open)), max(int(S(11)), 1), (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(cv, (int(ix + S(12)), int(iy + S(18) * eye_open)), max(int(S(6)), 1), (255, 255, 255), -1, cv2.LINE_AA)
            cv2.ellipse(cv, (int(ex), int(ey)), (int(S(66)), int(S(78) * eye_open)), 0, 195, 345, LINE, 9, cv2.LINE_AA)
        else:
            cv2.ellipse(cv, (int(ex), int(ey + S(14))), (int(S(62)), int(S(20))), 0, 15, 165, LINE, 8, cv2.LINE_AA)
        ell(cv, (ex + sg * S(10), ey + S(100)), (S(30), S(13)), (150, 140, 255), None) if blush else None
        cv2.line(cv, (int(ex - S(55)), int(ey - S(105) - sg * 4)), (int(ex + S(55)), int(ey - S(110) + sg * 4)), LINE, 7, cv2.LINE_AA)
    cv2.line(cv, (int(cx), int(cy + S(120))), (int(cx - S(8)), int(cy + S(140))), SKIN_S, 5, cv2.LINE_AA)
    if mouth < .1: cv2.ellipse(cv, (int(cx), int(cy + S(190))), (int(S(26)), int(S(10))), 0, 10, 170, LINE, 5, cv2.LINE_AA)
    else: ell(cv, (cx, cy + S(195)), (S(24), S(30) * mouth), (60, 40, 150), LINE, 4)
    # flequillo
    sw = sway * S(8)
    poly(cv, [(cx - S(235), cy - S(20)), (cx - S(200), cy - S(210)), (cx, cy - S(250)), (cx + S(200), cy - S(210)), (cx + S(235), cy - S(20)),
              (cx + S(160), cy - S(110) + sw), (cx + S(110), cy + S(20) + sw), (cx + S(40), cy - S(120)), (cx - S(30), cy + S(10) - sw),
              (cx - S(100), cy - S(130)), (cx - S(150), cy + S(20) - sw), (cx - S(170), cy - S(100))], HAIR)
    poly(cv, [(cx - S(200), cy - S(210)), (cx, cy - S(250)), (cx + S(200), cy - S(210)), (cx + S(150), cy - S(160)), (cx, cy - S(190)), (cx - S(150), cy - S(160))], HAIR_S, None)
    ell(cv, (cx - S(70), cy - S(190)), (S(60), S(12)), (255, 235, 245), None, 0, -12)

def mika_small(cv, x, y, s, t, look=0, step=2):
    """cuerpo completo pequeño (azotea), pelo y cordón mecidos cada 'step' cuadros"""
    sw = math.sin((t // step) * step * 7.0)
    S = lambda v: v * s
    poly(cv, [(x - S(34), y - S(170)), (x - S(26), y), (x - S(8), y), (x, y - S(90)), (x + S(8), y), (x + S(26), y), (x + S(34), y - S(170))], (80, 50, 60))   # pantalón
    for sg in (-1, 1): ell(cv, (x + sg * S(20), y + S(6)), (S(26), S(10)), (240, 240, 245), LINE, 3)
    poly(cv, [(x - S(52), y - S(330)), (x + S(52), y - S(330)), (x + S(64), y - S(150)), (x - S(64), y - S(150))], HOOD)                     # sudadera
    poly(cv, [(x - S(64), y - S(300)), (x - S(100) + sw * 5, y - S(160)), (x - S(80), y - S(150)), (x - S(52), y - S(250))], HOOD_S)
    poly(cv, [(x + S(64), y - S(300)), (x + S(100) - sw * 5, y - S(160)), (x + S(80), y - S(150)), (x + S(52), y - S(250))], HOOD_S)
    poly(cv, [(x - S(60), y - S(330)), (x - S(88) + sw * 10, y - S(260)), (x - S(80) + sw * 10, y - S(240)), (x - S(40), y - S(320))], HOOD_S)   # capucha
    poly(cv, [(x - S(58), y - S(420)), (x + S(58), y - S(420)), (x + S(78) + sw * 16, y - S(290)), (x + S(40), y - S(330)),
              (x - S(40), y - S(330)), (x - S(78) - sw * 16, y - S(290))], HAIR_S)                                                 # pelo trasero
    ell(cv, (x + look * S(4), y - S(380)), (S(46), S(52)), SKIN)
    poly(cv, [(x - S(54) + look * 3, y - S(380)), (x - S(48), y - S(436)), (x + S(44), y - S(442)), (x + S(56) + look * 3, y - S(380)),
              (x + S(36), y - S(400)), (x + S(14), y - S(386)), (x - S(8), y - S(404)), (x - S(30), y - S(388))], HAIR)             # flequillo
    cv2.circle(cv, (int(x + S(14) + look * S(6)), int(y - S(372))), max(int(S(5)), 1), LINE, -1, cv2.LINE_AA)
    cv2.circle(cv, (int(x - S(18) + look * S(6)), int(y - S(372))), max(int(S(5)), 1), LINE, -1, cv2.LINE_AA)

def lantern(cv, cx, cy, s, t):
    """espíritu farol (original): orbe naranja con carita"""
    cv = glow(cv, (cx, cy), 150 * s, (60, 150, 255), 0.9)
    ell(cv, (cx, cy), (50 * s, 58 * s), (80, 190, 255), (30, 60, 150), 4)
    ell(cv, (cx, cy - 6 * s), (30 * s, 36 * s), (170, 235, 255), None)
    for sg in (-1, 1): cv2.circle(cv, (int(cx + sg * 17 * s), int(cy - 4 * s)), max(int(5 * s), 1), (30, 40, 90), -1, cv2.LINE_AA)
    cv2.ellipse(cv, (int(cx), int(cy + 12 * s)), (int(10 * s), int(7 * s)), 0, 10, 170, (30, 40, 90), 3, cv2.LINE_AA)
    poly(cv, [(cx - 14 * s, cy - 52 * s), (cx, cy - 92 * s + 6 * math.sin(t * 9)), (cx + 14 * s, cy - 52 * s)], (60, 160, 255), (30, 60, 150), 3)
    return cv

def speed_lines(cv, n=70, seed=0, inner=130, color=(255, 255, 255)):
    r = np.random.RandomState(seed); c = (W // 2, H // 2)
    for _ in range(n):
        a = r.rand() * 2 * math.pi; r0 = inner + r.rand() * 260; r1 = r0 + 300 + r.rand() * 600
        p0 = (int(c[0] + math.cos(a) * r0 * 1.4), int(c[1] + math.sin(a) * r0)); p1 = (int(c[0] + math.cos(a) * r1 * 1.4), int(c[1] + math.sin(a) * r1))
        cv2.line(cv, p0, p1, color, int(2 + r.rand() * 5), cv2.LINE_AA)

def zoom(cv, k, cx=W / 2, cy=H / 2):
    M = np.float32([[k, 0, cx - k * cx], [0, k, cy - k * cy]])
    return cv2.warpAffine(cv, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
def shake(cv, a, f):
    r = np.random.RandomState(f + 100); M = np.float32([[1, 0, r.uniform(-a, a)], [0, 1, r.uniform(-a, a)]])
    return cv2.warpAffine(cv, M, (W, H), borderMode=cv2.BORDER_REPLICATE)

# ---------- planos ----------
def shot_A(t, f):                           # ciudad, paneo lento
    cv = city(t, 0, 520, 4.0, f); return finish(cv, f)
def shot_B(t, f):                           # primer plano de Mika, ojos
    d = int(t * FPS // 3) * 3 / FPS          # dibujo nuevo cada 3 cuadros
    bg = room_bg(f); k = 1.0 + 0.05 * ease(t / 4.0)
    blink = (d % 2.0) > 1.80
    eo = 0.0 if blink else (0.9 + 0.1 * math.sin(d * 3))
    lx = 0.0 if t < 1.0 else (-1.0 if t < 2.4 else -1.0 + 2.0 * ease((t - 2.4) / 0.3))   # mira a la puerta
    look = (lx, 0.0) if t <= 3.0 else (1.0, 0.2)
    sway = math.sin(d * 4)
    face(bg, 760, 330, 1.0, eo, look, sway, 0.0)
    return finish(zoom(bg, k, 760, 330), f)
def shot_C(t, f):                           # mano en el pomo + impacto
    bg = grad(W, H, (40, 26, 36), (24, 16, 22)); k = 1 + 0.15 * ease(t / 2.0)
    cv2.rectangle(bg, (300, 0), (980, 720), (70, 80, 110), -1)                  # puerta
    cv2.rectangle(bg, (340, 40), (940, 680), (84, 100, 140), -1)
    cv2.rectangle(bg, (340, 40), (940, 680), LINE, 6)
    ell(bg, (860, 380), (54, 54), (150, 190, 220), LINE, 5); ell(bg, (860, 380), (28, 28), (200, 225, 245), None)       # pomo
    ang = -0.35 * ease((t - 0.8) / 0.7) if t > 0.8 else 0
    hand = [(560, 520), (720, 330), (800, 360), (850, 340), (880, 370), (870, 410), (820, 450), (740, 560)]
    c = np.array(hand, np.float32); c = (c - (860, 380)) @ np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]]).T + (860, 380)
    poly(bg, c, SKIN); poly(bg, [(560, 520), (720, 330), (680, 300), (500, 480)], HOOD)
    for i in range(3): cv2.line(bg, (int(c[2][0] - 8 + i * 14), int(c[2][1] + 10)), (int(c[3][0] - 6 + i * 12), int(c[3][1] + 34)), SKIN_S, 4, cv2.LINE_AA)
    bg = zoom(bg, k, 860, 380)
    if 1.3 < t < 1.75: speed_lines(bg, 80, f // 2)
    if 1.3 < t < 1.75: bg = shake(bg, 14, f)
    if 1.75 <= t < 1.92: bg = np.full_like(bg, 255)                              # cuadro de impacto: blanco
    elif 1.92 <= t < 2.0: bg = 255 - bg                                          # y negativo
    return finish(bg, f, 0.45)
def shot_D(t, f):                           # azotea, plano general
    d = int(t * FPS // 2) * 2 / FPS
    cv = city(t + 4, 700, 900, 12.0, f)
    cv = cv.copy(); poly(cv, [(0, 620), (W, 600), (W, H), (0, H)], (58, 42, 52), None)
    for x in range(40, W, 90): cv2.line(cv, (x, 610), (x, 560), (46, 30, 40), 5, cv2.LINE_AA)
    cv2.line(cv, (0, 560), (W, 560), (46, 30, 40), 7, cv2.LINE_AA)
    mika_small(cv, 330, 640, 0.95, d, 1 if t > 2.8 else 0, 2)
    ly = 330 + 40 * math.sin(t * 2.2) - 60 * ease(t / 5.0)
    lx = 1040 - 360 * ease(t / 5.5)
    cv = lantern(cv, lx, ly, 1.0, t)
    return finish(zoom(cv, 1.0 + 0.10 * ease(t / 6.0), 700, 420), f)
def shot_E(t, f):                           # gag chibi
    d = int(t * FPS // 2) * 2
    bg = np.full((H, W, 3), (170, 220, 255), np.uint8); c = (W // 2, H // 2)
    for i in range(36):
        a0 = 2 * math.pi * i / 36 + d * .01; a1 = a0 + math.pi / 36
        poly(bg, [c, (c[0] + int(math.cos(a0) * 1500), c[1] + int(math.sin(a0) * 1500)), (c[0] + int(math.cos(a1) * 1500), c[1] + int(math.sin(a1) * 1500))],
             (200, 170, 255) if i % 2 else (150, 215, 255), None)
    j = np.random.RandomState(d).uniform(-6, 6, 2) if t > .25 else (0, 0)
    cx, cy = W // 2 + j[0], H // 2 + 20 + j[1]
    ell(bg, (cx, cy), (260, 250), SKIN); poly(bg, [(cx - 270, cy - 40), (cx - 240, cy - 230), (cx, cy - 270), (cx + 240, cy - 230), (cx + 270, cy - 40), (cx + 120, cy - 150), (cx, cy - 90), (cx - 130, cy - 150)], HAIR)
    for sg in (-1, 1):
        ell(bg, (cx + sg * 100, cy - 10), (82, 96), (255, 255, 255), LINE, 6); cv2.circle(bg, (int(cx + sg * 100 + sg * 6), int(cy - 6)), 10, LINE, -1, cv2.LINE_AA)
        cv2.line(bg, (int(cx + sg * 100 - 70), int(cy - 130 - sg * 8)), (int(cx + sg * 100 + 70), int(cy - 150 + sg * 8)), LINE, 8, cv2.LINE_AA)
    pts = np.array([(cx - 70 + i * 14, cy + 140 + 12 * math.sin(i * 1.4 + d)) for i in range(11)], np.int32); cv2.polylines(bg, [pts], False, LINE, 8, cv2.LINE_AA)
    poly(bg, [(cx + 230, cy - 150), (cx + 262, cy - 90), (cx + 230, cy - 60), (cx + 200, cy - 90)], (255, 190, 90), LINE, 4)    # gota
    if t > 2.6: bg = (bg * (1 - ease((t - 2.6) / .8))).astype(np.uint8)
    return finish(bg, f, 0.35)

SHOTS = [(4.0, shot_A), (4.0, shot_B), (2.0, shot_C), (6.0, shot_D), (3.4, shot_E)]
def build(preview=False):
    os.makedirs(OUT + '/fr', exist_ok=True); f = 0; frames = []
    for dur, fn in SHOTS:
        for i in range(int(dur * FPS)):
            frames.append((fn, i / FPS, f)); f += 1
    sel = frames if not preview else frames[::int(len(frames) / 12)]
    for n, (fn, t, fi) in enumerate(sel):
        cv2.imwrite(f'{OUT}/fr/f_{n:04d}.png', fn(t, fi))
    return len(frames), len(sel)

if __name__ == '__main__':
    import sys
    print(build(preview='prev' in sys.argv))
