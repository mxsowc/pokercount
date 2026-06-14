#!/usr/bin/env python3
"""Export a trained checkpoint to the format the web app loads:
   public/models/cards-yolov8.onnx  +  public/models/cards-classes.json

The class list is read from the model itself, so the app's labels can never
drift from what was trained (the guard against the 'consistently wrong' bug).
"""
import argparse, json, os, shutil
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, "..", "public", "models"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="runs/detect/cards/weights/best.pt")
    ap.add_argument("--imgsz", type=int, default=960)
    a = ap.parse_args()

    m = YOLO(a.weights)
    names = [m.names[i] for i in range(len(m.names))]
    assert len(names) == len(set(names)) == 52, f"expected 52 unique classes, got {names}"
    os.makedirs(MODELS, exist_ok=True)
    json.dump(names, open(os.path.join(MODELS, "cards-classes.json"), "w"))

    # dynamic=True so the web app can choose inference resolution freely.
    path = m.export(format="onnx", imgsz=a.imgsz, dynamic=True, opset=12, simplify=True)
    shutil.copy(path, os.path.join(MODELS, "cards-yolov8.onnx"))
    print("wrote:")
    print(" ", os.path.join(MODELS, "cards-yolov8.onnx"))
    print(" ", os.path.join(MODELS, "cards-classes.json"))
    print("classes:", names)


if __name__ == "__main__":
    main()
