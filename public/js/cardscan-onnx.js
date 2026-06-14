// SPIKE — real on-device card recognition via ONNX Runtime Web + a YOLOv8
// playing-card detector.
//
// The ORT runtime (from the jsdelivr CDN) and the model are loaded lazily on the
// first scan; inference runs in the browser, so the photo never leaves the
// device. If the model file isn't present (or ORT can't load), the recognizer
// throws { code:'model-unavailable' } so the caller can fall back to the mock.
//
// You must supply the model: see /models/README.md for the 3-command conversion
// of a public YOLOv8 playing-card .pt into the .onnx this expects.

const ORT_VERSION = '1.20.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

// Class order of the Roboflow "playing cards" datasets (names sorted
// alphabetically). This MUST match the `names` baked into YOUR model — the
// export script prints them; replace this array if your model differs.
export const ROBOFLOW_CARD_CLASSES = [
  '10C', '10D', '10H', '10S', '2C', '2D', '2H', '2S', '3C', '3D', '3H', '3S', '4C', '4D', '4H', '4S',
  '5C', '5D', '5H', '5S', '6C', '6D', '6H', '6S', '7C', '7D', '7H', '7S', '8C', '8D', '8H', '8S',
  '9C', '9D', '9H', '9S', 'AC', 'AD', 'AH', 'AS', 'JC', 'JD', 'JH', 'JS', 'KC', 'KD', 'KH', 'KS',
  'QC', 'QD', 'QH', 'QS',
];

// 'AS' -> 'As', '10C' -> 'Tc', '2H' -> '2h'  (the engine's canonical token).
function classToToken(name) {
  const suit = String(name).slice(-1).toLowerCase();
  let rank = String(name).slice(0, -1).toUpperCase();
  if (rank === '10') rank = 'T';
  return rank + suit;
}

const VALID_TOKEN = /^(?:[2-9]|T|J|Q|K|A)[cdhs]$/;

// Turn a class-name list into an index→token array, throwing loudly if it isn't a
// clean 52-card mapping. THIS is the guard against the "consistently wrong"
// failure: a short/duplicate/garbled class list fails fast instead of silently
// mislabelling every detection.
function buildTokenMap(names) {
  if (!Array.isArray(names) || names.length === 0) {
    const e = new Error('bad-classes: class list missing or empty'); e.code = 'bad-classes'; throw e;
  }
  const tokens = names.map(classToToken);
  const bad = tokens.find((t) => !VALID_TOKEN.test(t));
  if (bad) { const e = new Error(`bad-classes: invalid card "${bad}"`); e.code = 'bad-classes'; throw e; }
  if (new Set(tokens).size !== tokens.length) {
    const e = new Error('bad-classes: duplicate cards in class list'); e.code = 'bad-classes'; throw e;
  }
  if (tokens.length !== 52) {
    const e = new Error(`bad-classes: expected 52 classes, got ${tokens.length}`); e.code = 'bad-classes'; throw e;
  }
  return tokens;
}

// Prefer the class order EXPORTED WITH THE MODEL (the sidecar JSON the export
// script writes) over any hardcoded default — so the labels can never drift from
// the model that produced the detections.
async function resolveTokenMap(classesUrl, fallbackNames) {
  if (classesUrl) {
    try {
      const res = await fetch(classesUrl, { cache: 'force-cache' });
      if (res.ok) {
        const json = await res.json();
        const names = Array.isArray(json) ? json : (json && json.names);
        return { tokens: buildTokenMap(names), source: classesUrl };
      }
    } catch (e) {
      if (e.code === 'bad-classes') throw e; // present but broken → fail loud, don't fall back
      // missing file / network error → fall through to the default below
    }
  }
  console.warn('[cardscan] no model class list at', classesUrl,
    '— using the built-in default order. VERIFY it matches your model, or labels may be wrong.');
  return { tokens: buildTokenMap(fallbackNames), source: 'default (UNVERIFIED)' };
}

// ---- lazy ORT loader (UMD bundle → window.ort) -------------------------------
let ortPromise = null;
function loadOrt() {
  if (typeof window !== 'undefined' && window.ort) return Promise.resolve(window.ort);
  if (!ortPromise) {
    ortPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ORT_BASE + 'ort.min.js';
      s.onload = () => resolve(window.ort);
      s.onerror = () => reject(new Error('ort-load-failed'));
      document.head.appendChild(s);
    }).then((ort) => { ort.env.wasm.wasmPaths = ORT_BASE; return ort; });
  }
  return ortPromise;
}

// ---- letterbox preprocess (bitmap → Float32 NCHW, RGB, /255) -----------------
function preprocess(bitmap, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(114,114,114)'; // YOLO letterbox padding
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  ctx.drawImage(bitmap, (size - w) >> 1, (size - h) >> 1, w, h);

  const { data } = ctx.getImageData(0, 0, size, size); // RGBA
  const plane = size * size;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4] / 255;             // R plane
    out[plane + i] = data[i * 4 + 1] / 255; // G plane
    out[2 * plane + i] = data[i * 4 + 2] / 255; // B plane
  }
  return out;
}

// ---- non-max suppression (class-aware) ---------------------------------------
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-9);
}
function nms(dets, iouThresh) {
  dets.sort((p, q) => q.score - p.score);
  const keep = [];
  for (const d of dets) {
    if (keep.some((k) => k.classId === d.classId && iou(k.box, d.box) > iouThresh)) continue;
    keep.push(d);
  }
  return keep;
}

/**
 * Build a recognizer compatible with cardscan.js's setCardRecognizer().
 * Returns: (bitmap, { count }) -> Promise<[{ card, confidence }]>
 */
export function onnxRecognizer({
  modelUrl = '/models/cards-yolov8.onnx',
  classesUrl = '/models/cards-classes.json',
  classNames = ROBOFLOW_CARD_CLASSES,
  size = 640,            // must be a multiple of 32; match it to the export imgsz,
                         // or export with dynamic=True to vary it freely (see README)
  confThreshold = 0.25,  // detection floor (raw YOLO score)
  iouThreshold = 0.45,
} = {}) {
  // Load the runtime, the model and the (validated) label map once.
  let initPromise = null;
  const init = () => {
    if (!initPromise) {
      initPromise = (async () => {
        const ort = await loadOrt();
        const { tokens, source } = await resolveTokenMap(classesUrl, classNames);
        let session;
        try {
          session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu', 'wasm'] });
        } catch (e) {
          const err = new Error('model-unavailable: ' + (e && e.message ? e.message : e));
          err.code = 'model-unavailable';
          throw err;
        }
        console.info('[cardscan] model ready; label source:', source);
        return { ort, session, tokens };
      })().catch((e) => { initPromise = null; throw e; }); // allow a retry next scan
    }
    return initPromise;
  };

  return async (bitmap, { count = 5 } = {}) => {
    const { ort, session, tokens } = await init();

    const tensor = new ort.Tensor('float32', preprocess(bitmap, size), [1, 3, size, size]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    const data = output.data;

    // YOLOv8 detect output is [1, 4+nc, anchors] (channels-first) or, in some
    // exports, [1, anchors, 4+nc]. Detect which by comparing the two dims.
    const d1 = output.dims[1], d2 = output.dims[2];
    const channelsFirst = d1 < d2;
    const ch = channelsFirst ? d1 : d2;
    const anchors = channelsFirst ? d2 : d1;
    const nc = ch - 4;
    // The model's class count must match our label map, or every label is off.
    if (nc !== tokens.length) {
      const e = new Error(`bad-classes: model has ${nc} classes but the label list has ${tokens.length}`);
      e.code = 'bad-classes'; throw e;
    }
    const at = (row, a) => (channelsFirst ? data[row * anchors + a] : data[a * ch + row]);

    const dets = [];
    for (let a = 0; a < anchors; a++) {
      let best = -1, bestScore = 0;
      for (let c = 0; c < nc; c++) {
        const s = at(4 + c, a);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (bestScore < confThreshold) continue;
      const cx = at(0, a), cy = at(1, a), w = at(2, a), h = at(3, a);
      dets.push({ classId: best, score: bestScore, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] });
    }

    const seen = new Set();
    const out = [];
    for (const d of nms(dets, iouThreshold)) {
      const token = tokens[d.classId];
      if (!token || seen.has(token)) continue; // one detection per distinct card
      seen.add(token);
      out.push({ card: token, confidence: d.score });
      if (out.length >= count) break;
    }
    return out;
  };
}
