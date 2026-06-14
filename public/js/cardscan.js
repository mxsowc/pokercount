// SPIKE — camera → card tokens for the pot splitter.
//
// The UI and the recognition model are deliberately decoupled: this module owns
// *capture* and a *pluggable recognizer*, and returns raw guesses. It does NOT
// know poker rules — pot.js applies the results through its existing
// canonicalize/dedupe/slot logic, so there's one validation boundary, not two.
//
// Privacy/architecture note: capture and inference are meant to run ON-DEVICE.
// Nothing here uploads anything. A real recognizer (see the note at the bottom)
// should keep that property; a cloud API would break the app's offline/no-server
// ethos and should be an explicit, disclosed opt-in.

// ---- pluggable recognizer ----------------------------------------------------
// Contract: recognizer(bitmap, { count, kind }) -> Promise<Array<{card, confidence}>>
//   bitmap     : ImageBitmap of the captured photo
//   count      : how many cards this field wants (board=5, hole=2/4)
//   kind       : 'board' | 'hole'
//   card       : canonical-ish token, e.g. 'As','Td' (pot.js re-validates)
//   confidence : 0..1
let recognizer = null;
export function setCardRecognizer(fn) { recognizer = fn; }
export function hasRecognizer() { return !!recognizer; }

// ---- capture -----------------------------------------------------------------
// Native camera via a file input. Simplest possible: no getUserMedia, no live
// video, no permission dance — the OS camera app handles framing, and on desktop
// it falls back to a normal file picker. Resolves null if the user cancels.
export function capturePhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // hint: rear camera on phones
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve((input.files && input.files[0]) || null);
      input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// ---- recognize ---------------------------------------------------------------
export async function recognizeCards(file, opts = {}) {
  if (!recognizer) { const e = new Error('no-recognizer'); e.code = 'no-recognizer'; throw e; }
  const bitmap = await createImageBitmap(file);
  try {
    const out = await recognizer(bitmap, { count: opts.count || 5, kind: opts.kind || 'board' });
    return Array.isArray(out) ? out : [];
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

// ---- mock recognizer (DEMO ONLY) ---------------------------------------------
// Exercise the capture → draft → confirm flow with NO model installed. It ignores
// the image and returns a fixed plausible hand, with the last card low-confidence
// so you can see how flagging would feel. Enable in pot.js via `?scan=mock`.
export function mockRecognizer() {
  return async (_bitmap, { count, kind }) => {
    const deck = ['As', 'Kd', 'Qh', 'Jc', 'Ts', '9h', '8d', '7c', '6s', '5h'];
    const n = Math.min(count, kind === 'hole' ? count : 5);
    return deck.slice(0, n).map((card, i) => ({ card, confidence: i === n - 1 ? 0.55 : 0.95 }));
  };
}

// ---- wiring a REAL recognizer ------------------------------------------------
// Recommended on-device path (keeps photos on the phone):
//
//   import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js';
//   const session = await ort.InferenceSession.create('/models/cards-yolov8n.onnx',
//                       { executionProviders: ['webgpu', 'wasm'] });
//   setCardRecognizer(async (bitmap, { count }) => {
//     const input = letterboxToTensor(bitmap, 640);          // canvas → Float32 NCHW
//     const { output0 } = await session.run({ images: input });
//     const dets = nms(decodeYolo(output0), 0.45);           // [{classId, score, box}]
//     return dets.sort((a,b) => b.score - a.score)
//                .slice(0, count)
//                .map(d => ({ card: CLASS_TO_TOKEN[d.classId], confidence: d.score }));
//   });
//
// Model: a YOLOv8-nano playing-card detector (52 classes), exported to ONNX
// (~6–12 MB, cached after first load). Public playing-card datasets/models exist
// to bootstrap before training your own.
//
// Fastest accuracy spike (NOT for shipping — uploads the image): a hosted
// inference endpoint (e.g. a Roboflow "playing cards" model) wired into the same
// setCardRecognizer() contract.
