// Lightweight audio ping helper for the Object Seeker.
// This module intentionally does not open any USB device.

export function playSonarPing(): boolean {
  // Sonar ping is handled by the browser audio context; not a USB device.
  return false;
}

export const _audioSonarRevision = 2 as const;
