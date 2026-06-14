#!/usr/bin/env python3
"""Train YOLOv8 on the generated card dataset.

Run on a GPU (Colab/local CUDA) — CPU training is impractical. Defaults are
tuned for cards: medium model, high resolution (small rank/suit pips), and
augmentation that helps real-world robustness without destroying card identity.
"""
import argparse
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="dataset/data.yaml")
    ap.add_argument("--model", default="yolov8m.pt", help="yolov8s.pt is faster, yolov8m.pt more accurate")
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--name", default="cards")
    a = ap.parse_args()

    YOLO(a.model).train(
        data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, name=a.name,
        patience=20,
        # Geometry helps generalisation; keep flips OFF — a flipped card is a
        # different/invalid card, and vertical flip would corrupt rank/suit.
        fliplr=0.0, flipud=0.0,
        degrees=10, translate=0.1, scale=0.5, shear=4, perspective=0.0005,
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.4,
        mosaic=1.0, close_mosaic=10, mixup=0.0,
    )
    print("done — best weights under runs/detect/<name>/weights/best.pt")


if __name__ == "__main__":
    main()
