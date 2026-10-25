// Optional second browser object detector. YOLOS-tiny is a transformer-based
// object detector, NOT Ultralytics YOLO. This browser-safe fallback allows
// comparison without a local Python server or changing the production camera.
export interface ExtraPrediction {
  bbox: [number, number, number, number]; // x, y, width, height
  class: string;
  score: number;
}
type Detector = (image: string, options?: Record<string, unknown>) => Promise<Array<{
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}>>;
let detectorPromise: Promise<Detector> | undefined;

export async function loadExtraDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = import("@huggingface/transformers")
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = false;
        return (await pipeline("object-detection", "Xenova/yolos-tiny", { device: "wasm" })) as unknown as Detector;
      })
      .catch((error) => {
        detectorPromise = undefined; // retry allowed
        throw error;
      });
  }
  return detectorPromise;
}

export async function detectExtra(canvas: HTMLCanvasElement): Promise<ExtraPrediction[]> {
  const detector = await loadExtraDetector();
  const results = await detector(canvas.toDataURL("image/jpeg", 0.8), { threshold: 0.45 });
  return results.map((item) => ({
    bbox: [item.box.xmin, item.box.ymin, item.box.xmax - item.box.xmin, item.box.ymax - item.box.ymin] as [number, number, number, number],
    class: item.label,
    score: item.score,
  })).filter((p) => p.bbox[2] > 0 && p.bbox[3] > 0);
}

export function combineDetections(
  first: ExtraPrediction[],
  second: ExtraPrediction[],
  iouThreshold = 0.55,
): ExtraPrediction[] {
  const all = [...first, ...second].filter((p) => p.score >= 0.45).sort((a,b) => b.score-a.score);
  const result: ExtraPrediction[] = [];
  for (const p of all) {
    const [x = 0, y = 0, w = 0, h = 0] = p.bbox;
    const duplicate = result.some((q) => {
      if (q.class.toLowerCase() !== p.class.toLowerCase()) return false;
      const [qx = 0, qy = 0, qw = 0, qh = 0] = q.bbox;
      const iw = Math.max(0,Math.min(x+w,qx+qw)-Math.max(x,qx));
      const ih = Math.max(0,Math.min(y+h,qy+qh)-Math.max(y,qy));
      return iw*ih / Math.max(w*h+qw*qh-iw*ih, 1e-9) >= iouThreshold;
    });
    if (!duplicate) result.push(p);
  }
  return result;
}
