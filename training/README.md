# Training a card detector that survives real photos

The off-the-shelf models failed because they were trained on **synthetic/clean
card renders** and don't transfer to real photographs (we measured this: great on
synthetic, ~nothing on real). The fix is to train on data that looks like *your*
real conditions. Hand-labelling thousands of photos is the naive way; this
pipeline does it the smart way:

> **Photograph your 52 cards once + collect background photos → the generator
> composites them into thousands of perfectly-labelled, realistic scenes → train
> YOLOv8 → export into the app.** No manual labelling.

The realism of your inputs is everything. Use **photos of real cards** (not vector
art) and **real backgrounds** (felt, tables, hands, rooms) and the synthetic→real
gap mostly closes. Optionally fine-tune on a small set of hand-labelled real board
photos for the last mile.

## 0. Effort & expectations (be honest)

- ~1–2 hrs to photograph 52 cards + gather 30–100 backgrounds.
- Generation: minutes. Training: ~1–3 hrs on a Colab T4/A100 GPU. **CPU is impractical.**
- Realistic result: solid on clear, flat, well-lit board cards; still imperfect on
  glare/overlap/odd decks. It's a draft-the-user-confirms feature — the app already
  treats it that way (confidence gating + the manual picker for fixes).

## 1. Prepare inputs

```
training/
  cards/         # 52 images named by code: As.png 10h.png Kc.jpg 2c.png …
  backgrounds/   # 30+ background photos (felt, table, hands, rooms)
```

- **cards/**: one image per card. Rank ∈ `A,2,3,4,5,6,7,8,9,10,J,Q,K`, suit ∈
  `c,d,h,s`. PNG with a transparent background is ideal (clean cut-out); opaque
  rectangular scans/photos also work (the whole rectangle is treated as the card).
  Easiest capture: lay the deck out, photograph each card flat, crop, name it.
- **backgrounds/**: more variety = better. Include the felt/table you actually play
  on. (No backgrounds → procedural fallback, noticeably worse — don't skip this.)

## 2. Generate the dataset (CPU, anywhere)

```bash
pip install opencv-python-headless numpy
python generate_dataset.py --cards cards --backgrounds backgrounds --n 8000 --size 960
# → dataset/{train,valid}/{images,labels}, dataset/data.yaml, dataset/cards-classes.json
```

Spot-check a few `dataset/train/images/*.jpg` against their `labels/*.txt` before
training (a quick YOLO label viewer, or trust it — labels are exact by construction).

## 3. Train (GPU — Colab)

```bash
pip install ultralytics
python train.py --data dataset/data.yaml --model yolov8m.pt --imgsz 960 --epochs 80
# best weights → runs/detect/cards/weights/best.pt
```

`yolov8s.pt` trains faster / smaller download; `yolov8m.pt` is more accurate. Watch
`mAP50-95` on the validation split — that's your real accuracy signal.

Quick win: also fine-tune from the existing synthetic checkpoint instead of COCO
(`--model <that>.pt`) if you have one — faster convergence.

## 4. Export into the app

```bash
python export.py --weights runs/detect/cards/weights/best.pt --imgsz 960
# writes public/models/cards-yolov8.onnx + cards-classes.json
```

Then reload `/pot` and Scan. The app reads the class order from
`cards-classes.json`, so labels always match the model. Tune inference resolution
(`onnxRecognizer({ size })` in `public/js/pot.js`) and `SCAN_TRUST` to taste.

Mind the **download size**: yolov8m ≈ 100 MB ONNX (heavy for web — host on a CDN,
or use yolov8s ≈ 40 MB). Re-export at a lower `imgsz` if you want it smaller/faster.

## 5. Optional last mile — fine-tune on real photos

If clear-photo accuracy is good but messy real tables still struggle: hand-label a
few hundred **real** board photos (Roboflow/Label Studio, same 52 classes/order),
and continue training from your synthetic `best.pt` on that set. Mixing synthetic +
real is what closes the gap fully.

---

Files: `generate_dataset.py` (synth generator), `train.py`, `export.py`,
`requirements.txt`, `colab.ipynb` (runs steps 2–4 on a Colab GPU).
