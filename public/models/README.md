# Card-recognition model (`/models/`)

The pot scanner ([`public/js/cardscan-onnx.js`](../js/cardscan-onnx.js)) runs a
YOLOv8 playing-card detector **on-device** via ONNX Runtime Web (no upload). It
needs two files here:

| File | What it is |
|------|------------|
| `cards-yolov8.onnx` | the detector (gitignored — ship via your CDN) |
| `cards-classes.json` | the model's class order as a JSON array, e.g. `["10C","10D",…]` |

**The labels come from `cards-classes.json`, not a hardcoded guess.** That's the
guard against the worst failure mode — a class-order mismatch that mislabels
*every* card the same way. The scanner refuses to run if that list isn't a clean
set of 52 distinct valid cards, or if it doesn't match the model's class count.

## Build the files (accuracy-tuned)

Requires Python with [`ultralytics`](https://pypi.org/project/ultralytics/)
(`pip install ultralytics`).

```bash
# 1. Get a trained YOLOv8 playing-card checkpoint (swap in a better one if you have it).
curl -L -o cards.pt \
  https://huggingface.co/mustafakemal0146/playing-cards-yolov8/resolve/main/playing_cards_model_0_playing-cards-colab.pt

# 2. Emit the EXACT class order next to the model, and export ONNX.
python - <<'PY'
from ultralytics import YOLO
import json
m = YOLO('cards.pt')
names = [m.names[i] for i in range(len(m.names))]   # index order the model uses
json.dump(names, open('public/models/cards-classes.json', 'w'))
print('classes:', names)
# dynamic=True lets the web app pick the input resolution (see "Accuracy" below);
# higher imgsz = better tiny rank/suit pips, slower inference.
m.export(format='onnx', imgsz=960, dynamic=True, opset=12, simplify=True)
PY
mv cards.onnx public/models/cards-yolov8.onnx
```

That's it — reload `/pot` and Scan runs real on-device inference. No file → it
falls back to placeholder cards and says so.

## Accuracy levers (biggest first)

1. **Input resolution.** Card rank/suit indices are tiny; 640px often loses them.
   With `dynamic=True` you can raise it in code without re-exporting — set
   `onnxRecognizer({ size: 960 })` (or 1280). Must be a multiple of 32. Slower,
   noticeably more accurate on board photos.
2. **Model + data.** A bigger model (YOLOv8**s**/**m**) and a large, varied,
   well-labelled dataset beat a nano model on a small dataset. If you can train
   on a four-colour-deck + glare + angle dataset, do.
3. **Confidence gating** (already in the app): `SCAN_TRUST` in `pot.js` — guesses
   below it are left as empty slots instead of confident wrong cards. Tune it.
4. **Capture conditions** dominate real-world accuracy: flat, spread, well-lit,
   non-overlapping cards. Board cards scan far better than fanned hole cards.
5. Future, not yet built: **tiling** the photo into overlapping 640 crops and
   merging detections (best for small pips with a fixed-size model), and
   test-time augmentation. Ask if you want these.

## Measure it before trusting it

Don't guess — quantify, so a regression or a bad mapping is obvious:

```bash
# mAP + per-class accuracy on a labelled validation set (data.yaml from your dataset).
yolo val model=cards.pt data=path/to/data.yaml imgsz=960
```

Then spot-check real phone photos through `/pot`. If detections are good but
labels are wrong, `cards-classes.json` doesn't match the model — re-run step 2.
