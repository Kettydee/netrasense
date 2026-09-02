/**
 * Audio Sonar Synthesizer for NetraSense "Find My Object" (Object Hound)
 * Uses Web Audio API to create adaptive audio sonar pulses that ping faster
 * and with higher frequency as the user approaches a target obstacle or item.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a single futuristic sonar blip/ping
 * @param distanceCm Distance to target in cm
 */
export function playSonarPing(distanceCm: number = 150) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Scale frequency from 400Hz (far) up to 950Hz (close)
    const clampedDist = Math.max(25, Math.min(300, distanceCm));
    const factor = 1 - (clampedDist - 25) / 275; // 1 = very close, 0 = far
    const frequency = 440 + factor * 500;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Smooth envelope attack and decay for a clean sonar blip
    const duration = factor > 0.8 ? 0.08 : 0.12;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (err) {
    console.warn("Sonar audio ping error:", err);
  }
}

/**
 * Controller for continuous adaptive sonar loop
 */
export class SonarTracker {
  private timerId: any = null;
  private isRunning: boolean = false;
  private currentDistance: number | null = null;

  start(getDistance: () => number | null) {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = () => {
      if (!this.isRunning) return;

      const dist = getDistance();
      this.currentDistance = dist;

      if (dist !== null && dist > 0) {
        playSonarPing(dist);

        // Ping interval: 200ms when very close (<40cm) up to 1100ms when far (>250cm)
        const clamped = Math.max(30, Math.min(300, dist));
        const factor = 1 - (clamped - 30) / 270;
        const intervalMs = Math.round(1100 - factor * 880);

        this.timerId = setTimeout(loop, Math.max(180, intervalMs));
      } else {
        // Target not in view; gentle standby pulse every 1800ms
        this.timerId = setTimeout(loop, 1800);
      }
    };

    loop();
  }

  updateDistance(dist: number | null) {
    this.currentDistance = dist;
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
