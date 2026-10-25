// Optional text-guided detection for objects missing from COCO's 80 classes.
// Model downloads in the browser only after the user selects Small Objects.
import type { ExtraPrediction } from "./browserDualDetector";
const LABELS = ["ring", "headphones", "computer mouse", "earbuds", "earphone", "watch", "keys", "wallet", "phone", "glasses", "bottle", "cup", "remote control"];
type RawResult = { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } };
type ZeroShot = (image: string, labels: string[], options?: Record<string, unknown>) => Promise<RawResult[]>;
let modelPromise: Promise<ZeroShot> | undefined;

export function loadSmallObjectDetector(): Promise<ZeroShot> {
  if (!modelPromise) {
    modelPromise = import("@huggingface/transformers")
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = false;
        return await pipeline("zero-shot-object-detection", "Xenova/owlvit-base-patch32", { device: "wasm" }) as unknown as ZeroShot;
      }).catch((error) => { modelPromise = undefined; throw error; });
  }
  return modelPromise;
}

export async function detectSmallObjects(canvas: HTMLCanvasElement): Promise<ExtraPrediction[]> {
  const model = await loadSmallObjectDetector();
  const found = await model(canvas.toDataURL("image/jpeg", 0.9), LABELS, { threshold: 0.18 });
  return found.filter(p => p.score >= 0.18).map(p => ({
    bbox: [p.box.xmin, p.box.ymin, p.box.xmax - p.box.xmin, p.box.ymax - p.box.ymin] as [number, number, number, number],
    class: p.label,
    score: p.score,
  })).filter(p => p.bbox[2] > 0 && p.bbox[3] > 0);
}
