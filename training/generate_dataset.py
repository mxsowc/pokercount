#!/usr/bin/env python3
"""Synthetic playing-card dataset generator for YOLOv8.

Composites photos of your 52 cards onto real backgrounds with realistic
augmentation (perspective, rotation, scale, lighting, blur, noise, JPEG,
overlap) and emits a YOLO-format dataset with PERFECT labels — no hand
labelling. This is the proven way (à la github.com/geaxgx/playing-card-detection)
to get a detector that survives real photos: the closer your card images and
backgrounds are to real conditions (real card photos, felt/table backgrounds),
the smaller the synthetic→real gap that wrecked the off-the-shelf models.

Inputs:
  --cards        dir of 52 card images named by code: As.png, 10h.png, Kc.jpg …
                 (rank ∈ A,2-10,J,Q,K ; suit ∈ c,d,h,s). PNG with transparency is
                 ideal; opaque rectangles also work (the whole rect is the card).
  --backgrounds  dir of background photos (felt, tables, rooms, hands). Strongly
                 recommended — real backgrounds matter. Falls back to procedural
                 backgrounds (worse) if empty.

Output: <out>/{train,valid}/{images,labels} + data.yaml + cards-classes.json
"""
import cv2, numpy as np, os, random, argparse, json, glob

RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
SUITS = ['c', 'd', 'h', 's']
CLASSES = [f"{r}{s}" for r in RANKS for s in SUITS]   # 52, fixed order
IDX = {c: i for i, c in enumerate(CLASSES)}


def find_cards(d):
    found, missing = {}, []
    for c in CLASSES:
        hit = next((p for ext in ('png', 'jpg', 'jpeg', 'webp', 'PNG', 'JPG')
                    for p in [os.path.join(d, f"{c}.{ext}")] if os.path.exists(p)), None)
        (found.__setitem__(c, hit) if hit else missing.append(c))
    return found, missing


def to_rgba(img):
    if img is None:
        raise ValueError("unreadable image")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 3:
        img = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
    return img


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua


def warp_card(card, target_h, max_skew=0.16, max_rot=22):
    """Scale to target height, apply random rotation+perspective. Returns RGBA
    cropped to its own bounding box."""
    h, w = card.shape[:2]
    s = target_h / h
    w2, h2 = max(2, int(w * s)), max(2, int(h * s))
    card = cv2.resize(card, (w2, h2), interpolation=cv2.INTER_AREA)
    src = np.float32([[0, 0], [w2, 0], [w2, h2], [0, h2]])
    sk = max_skew
    dst = np.float32([
        [random.uniform(0, sk * w2), random.uniform(0, sk * h2)],
        [w2 - random.uniform(0, sk * w2), random.uniform(0, sk * h2)],
        [w2 - random.uniform(0, sk * w2), h2 - random.uniform(0, sk * h2)],
        [random.uniform(0, sk * w2), h2 - random.uniform(0, sk * h2)],
    ])
    M = cv2.getPerspectiveTransform(src, dst)
    R = np.vstack([cv2.getRotationMatrix2D((w2 / 2, h2 / 2),
                                           random.uniform(-max_rot, max_rot), 1.0), [0, 0, 1]]).astype(np.float32)
    M = R @ M
    corners = cv2.perspectiveTransform(src.reshape(1, -1, 2), M).reshape(-1, 2)
    mn, mx = corners.min(0), corners.max(0)
    ow, oh = max(2, int(np.ceil(mx[0] - mn[0]))), max(2, int(np.ceil(mx[1] - mn[1])))
    T = np.float32([[1, 0, -mn[0]], [0, 1, -mn[1]], [0, 0, 1]])
    return cv2.warpPerspective(card, T @ M, (ow, oh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))


def paste(bg, fg, x, y):
    h, w = fg.shape[:2]
    H, W = bg.shape[:2]
    if x < 0 or y < 0 or x + w > W or y + h > H:
        return False
    roi = bg[y:y + h, x:x + w]
    a = fg[:, :, 3:4].astype(np.float32) / 255.0
    roi[:] = (a * fg[:, :, :3] + (1 - a) * roi).astype(np.uint8)
    return True


def augment(img):
    img = cv2.convertScaleAbs(img, alpha=random.uniform(0.7, 1.3), beta=random.uniform(-25, 25))
    if random.random() < 0.4:
        k = random.choice([3, 5])
        img = cv2.GaussianBlur(img, (k, k), 0)
    if random.random() < 0.4:
        n = np.random.normal(0, random.uniform(3, 12), img.shape).astype(np.int16)
        img = np.clip(img.astype(np.int16) + n, 0, 255).astype(np.uint8)
    if random.random() < 0.5:
        _, enc = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, random.randint(40, 92)])
        img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    return img


def random_bg(size):
    a = np.random.randint(0, 90, (2, 2, 3), np.uint8)
    return cv2.resize(a, (size, size), interpolation=cv2.INTER_LINEAR)


def gen_scene(cards, keys, bgs, size, min_c, max_c, max_overlap):
    bg = cv2.resize(random.choice(bgs), (size, size)) if bgs else random_bg(size)
    boxes = []
    for _ in range(random.randint(min_c, max_c)):
        c = random.choice(keys)
        warped = warp_card(to_rgba(cards[c]).copy(), random.randint(int(size * 0.18), int(size * 0.5)))
        wh, ww = warped.shape[:2]
        if ww >= size or wh >= size:
            continue
        for _try in range(25):
            x, y = random.randint(0, size - ww), random.randint(0, size - wh)
            nb = (x, y, x + ww, y + wh)
            if all(iou(nb, b[1:]) <= max_overlap for b in boxes) and paste(bg, warped, x, y):
                boxes.append((IDX[c],) + nb)
                break
    return augment(bg), boxes


def write(out, split, idx, img, boxes, size):
    cv2.imwrite(os.path.join(out, split, "images", f"{idx:06d}.jpg"), img,
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    with open(os.path.join(out, split, "labels", f"{idx:06d}.txt"), "w") as f:
        for cls, x1, y1, x2, y2 in boxes:
            cx, cy = (x1 + x2) / 2 / size, (y1 + y2) / 2 / size
            w, h = (x2 - x1) / size, (y2 - y1) / size
            f.write(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", required=True)
    ap.add_argument("--backgrounds", default="")
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--n", type=int, default=8000, help="total images")
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--size", type=int, default=960)
    ap.add_argument("--min-cards", type=int, default=1)
    ap.add_argument("--max-cards", type=int, default=5)
    ap.add_argument("--max-overlap", type=float, default=0.35)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    random.seed(a.seed); np.random.seed(a.seed)

    paths, missing = find_cards(a.cards)
    if not paths:
        raise SystemExit(f"No card images found in {a.cards} (expected As.png, 10h.png, …)")
    if missing:
        print(f"WARNING: {len(missing)} cards missing, generating with the {len(paths)} present: {missing}")
    cards = {c: to_rgba(cv2.imread(p, cv2.IMREAD_UNCHANGED)) for c, p in paths.items()}
    bgs = [cv2.imread(p) for ext in ('jpg', 'jpeg', 'png', 'JPG', 'PNG')
           for p in glob.glob(os.path.join(a.backgrounds, f"*.{ext}"))] if a.backgrounds else []
    bgs = [b for b in bgs if b is not None]
    print(f"{len(cards)} cards, {len(bgs)} backgrounds" + ("  (!) no backgrounds — using procedural, expect worse real-world results" if not bgs else ""))

    for split in ("train", "valid"):
        for sub in ("images", "labels"):
            os.makedirs(os.path.join(a.out, split, sub), exist_ok=True)
    keys = list(cards.keys())
    n_val = int(a.n * a.val_frac)
    for i in range(a.n):
        split = "valid" if i < n_val else "train"
        img, boxes = gen_scene(cards, keys, bgs, a.size, a.min_cards, a.max_cards, a.max_overlap)
        write(a.out, split, i, img, boxes, a.size)
        if (i + 1) % 500 == 0:
            print(f"  {i + 1}/{a.n}")

    with open(os.path.join(a.out, "data.yaml"), "w") as f:
        f.write(f"train: train/images\nval: valid/images\nnc: {len(CLASSES)}\nnames: {CLASSES}\n")
    json.dump(CLASSES, open(os.path.join(a.out, "cards-classes.json"), "w"))
    print(f"done → {a.out}  ({a.n} images, {len(CLASSES)} classes)")


if __name__ == "__main__":
    main()
