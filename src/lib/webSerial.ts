// Web Serial API manager for direct in-browser Arduino communication
// Zero Python backend, zero localhost, zero terminal required!
// Works directly on https://netrasense.vercel.app in Google Chrome, Edge, and Brave.

export type WebSerialReading = {
  distance_cm: number;
  threat_level: "NORMAL" | "WARNING" | "ALARM" | "CRITICAL";
  timestamp: string;
};

export class WebSerialReader {
  private port: any = null;
  private reader: any = null;
  private isReading = false;
  private onReadingCallbacks = new Set<(reading: WebSerialReading) => void>();
  private onStatusCallbacks = new Set<(connected: boolean, error?: string) => void>();

  public isSupported(): boolean {
    return typeof window !== "undefined" && "serial" in navigator;
  }

  public isConnected(): boolean {
    return this.isReading;
  }

  public async autoConnectIfAuthorized(): Promise<boolean> {
    if (!this.isSupported()) return false;
    this.setupConnectListener();
    try {
      const ports = await (navigator as any).serial.getPorts();
      // getPorts() can include previously authorized Bluetooth serial devices.
      // Only auto-connect when exactly one recognized USB serial adapter exists.
      const usbVendorIds = new Set([0x2341, 0x2a03, 0x1a86, 0x10c4, 0x0403, 0x2e8a]);
      const usbPorts = (ports ?? []).filter((port: any) => usbVendorIds.has(port.getInfo?.().usbVendorId));
      if (usbPorts.length === 1) {
        return await this.openPort(usbPorts[0]);
      }
    } catch {
      // ignore
    }
    return false;
  }

  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      alert(
        "Web Serial is not supported in this browser.\nPlease open https://netrasense.vercel.app in Google Chrome, Microsoft Edge, or Brave.",
      );
      return false;
    }

    try {
      // Limit the chooser to common Arduino boards and USB-to-serial adapters,
      // so paired audio/Bluetooth devices are not mistaken for the sensor.
      const port = await (navigator as any).serial.requestPort({
        filters: [
          { usbVendorId: 0x2341 }, // Arduino
          { usbVendorId: 0x2a03 }, // Arduino
          { usbVendorId: 0x1a86 }, // CH340/CH341
          { usbVendorId: 0x10c4 }, // CP210x
          { usbVendorId: 0x0403 }, // FTDI
          { usbVendorId: 0x2e8a }, // RP2040
        ],
      });
      return await this.openPort(port);
    } catch (err: any) {
      this.isReading = false;
      this.notifyStatus(false, err?.message || "Failed to connect to USB device");
      return false;
    }
  }

  private setupConnectListener() {
    if (this.isSupported() && typeof navigator !== "undefined" && (navigator as any).serial) {
      try {
        (navigator as any).serial.addEventListener("connect", () => {
          void this.autoConnectIfAuthorized();
        });
      } catch {
        // ignore
      }
    }
  }

  private async openPort(selectedPort: any): Promise<boolean> {
    try {
      if (this.port) {
        await this.disconnect();
      }
      this.port = selectedPort;
      await this.port.open({ baudRate: 9600 });
      this.isReading = true;

      // Do not publish a synthetic distance at connection time.
      // The dashboard should show no data until the first measurement arrives.
      this.smoothedDistance = null;
      this.recentSamples = [];
      this.lastEmitReading = null;
      this.lastEmitTime = 0;
      this.notifyStatus(true);

      // Start continuous background read loop
      this.readLoop();
      return true;
    } catch (err: any) {
      this.isReading = false;
      this.notifyStatus(false, err?.message || "Could not open serial port at 9600 baud");
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.isReading = false;
    try {
      if (this.reader) {
        await this.reader.cancel();
      }
    } catch {
      // ignore
    }

    try {
      if (this.port) {
        await this.closePort();
      }
    } catch {
      // ignore
    } finally {
      this.port = null;
      this.reader = null;
      this.recentSamples = [];
      this.smoothedDistance = null;
      this.lastEmitReading = null;
      this.notifyStatus(false);
    }
  }

  private recentSamples: number[] = [];
  private smoothedDistance: number | null = null;
  private lastEmitTime = 0;
  private lastEmitReading: WebSerialReading | null = null;

  private async readLoop() {
    let buffer = "";
    const decoder = new TextDecoder();

    if (this.isReading && this.port && !this.port.readable) {
      this.isReading = false;
      this.notifyStatus(false, "USB port opened, but no readable serial stream is available");
      return;
    }

    while (this.isReading && this.port && this.port.readable) {
      try {
        const reader = this.port.readable.getReader();
        this.reader = reader;

        try {
          while (this.isReading) {
            const { value, done } = await reader.read();
            if (done) {
              if (this.isReading) {
                this.isReading = false;
                this.notifyStatus(false, "USB serial stream ended");
              }
              break;
            }
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              // Serial devices vary: Arduino println uses CRLF, while some boards
              // and USB adapters send only CR or LF. Retain any incomplete final line.
              const lines = buffer.split(/[\r\n]+/);
              const hasLineEnding = /[\r\n]$/.test(buffer);
              buffer = hasLineEnding ? "" : (lines.pop() ?? "");
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) this.parseLine(trimmed);
              }

              // Some serial sketches print successive JSON readings without a
              // newline. Parse complete objects as soon as their closing brace
              // arrives instead of retaining the stream as one unfinished line.
              const jsonObjectPattern = /\{[^{}]*\}/g;
              let jsonMatch: RegExpExecArray | null;
              let consumedThrough = 0;
              while ((jsonMatch = jsonObjectPattern.exec(buffer)) !== null) {
                this.parseLine(jsonMatch[0]);
                consumedThrough = jsonObjectPattern.lastIndex;
              }
              if (consumedThrough > 0) {
                buffer = buffer.slice(consumedThrough);
              }
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
          this.reader = null;
        }
      } catch (err: any) {
        if (this.isReading) {
          this.isReading = false;
          this.notifyStatus(false, err?.message || "USB serial reading stopped");
        }
        break;
      }
    }
  }

  private parseLine(line: string) {
    try {
      let rawDistance: number | null = null;

      // Handle explicit clear pathway / timeout keywords from ultrasonic sensors
      if (/out of range|no obstacle|clear|infinity/i.test(line)) {
        rawDistance = 400;
      }

      // 1. JSON payload: {"distance_cm": 142.3} or {"distance": 142} or {"dist": 142} or {"cm": 142}
      if (rawDistance === null && line.includes("{") && line.includes("}")) {
        const match = line.match(/\{[^}]+\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            const val = parsed.distance_cm ?? parsed.distance ?? parsed.dist ?? parsed.cm ?? parsed.d;
            if (typeof val === "number" && isFinite(val)) {
              rawDistance = val;
            }
          } catch {
            // ignore JSON parse error
          }
        }
      }

      // 2. Labeled text: "Distance: 142.3 cm", "Distance = 142", "dist: 142", "Sonar: 142"
      if (rawDistance === null) {
        const labeledMatch = line.match(/(?:distance|dist|sonar|range|obstacle)[\s:=]+([-+]?\d+(?:\.\d+)?)/i);
        if (labeledMatch) {
          const val = parseFloat(labeledMatch[1]);
          if (!isNaN(val) && isFinite(val)) rawDistance = val;
        }
      }

      // 3. Plain number or "142 cm"
      if (rawDistance === null) {
        const simpleMatch = line.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*(?:cm)?\s*$/i);
        if (simpleMatch) {
          const val = parseFloat(simpleMatch[1]);
          if (!isNaN(val) && isFinite(val)) rawDistance = val;
        }
      }

      // 4. Standalone valid distance fallback
      if (rawDistance === null) {
        const anyNumMatch = line.match(/[-+]?\d+(?:\.\d+)?/);
        if (anyNumMatch) {
          const val = parseFloat(anyNumMatch[0]);
          if (!isNaN(val) && isFinite(val)) {
            rawDistance = val;
          }
        }
      }

      if (rawDistance === null || !isFinite(rawDistance)) return;

      // In ultrasonic physics, 0 or out-of-range (>380 cm) pulseIn return represents clear pathway ahead
      if (rawDistance <= 0 || rawDistance >= 380) {
        rawDistance = 400;
      }

      // Limit to sensor envelope (2 cm to 400 cm) and adopt real-time distance immediately with zero lag
      const bounded = Math.max(2, Math.min(400, rawDistance));
      const finalDistance = Number(bounded.toFixed(1));

      // Aligned Threat Level Classification matching NetraSense zones:
      // Critical (< 50 cm), Alarm (50 - 99 cm), Warning (100 - 300 cm), Normal (> 300 cm)
      let threat: "NORMAL" | "WARNING" | "ALARM" | "CRITICAL" = "NORMAL";
      if (finalDistance < 50) threat = "CRITICAL";
      else if (finalDistance < 100) threat = "ALARM";
      else if (finalDistance <= 300) threat = "WARNING";
      else threat = "NORMAL";

      const reading: WebSerialReading = {
        distance_cm: finalDistance,
        threat_level: threat,
        timestamp: new Date().toISOString(),
      };

      this.lastEmitReading = reading;
      this.lastEmitTime = Date.now();

      for (const cb of this.onReadingCallbacks) {
        try {
          cb(reading);
        } catch {
          // ignore callback error
        }
      }
    } catch {
      // ignore malformed lines
    }
  }

  private async closePort(): Promise<void> {
    try {
      if (this.port) await this.port.close();
    } catch {
      // ignore
    }
  }

  private notifyStatus(connected: boolean, error?: string) {
    for (const cb of this.onStatusCallbacks) {
      try {
        cb(connected, error);
      } catch {
        // ignore
      }
    }
  }

  public onReading(cb: (reading: WebSerialReading) => void): () => void {
    this.onReadingCallbacks.add(cb);
    return () => {
      this.onReadingCallbacks.delete(cb);
    };
  }

  public onStatus(cb: (connected: boolean, error?: string) => void): () => void {
    this.onStatusCallbacks.add(cb);
    cb(this.isReading);
    return () => {
      this.onStatusCallbacks.delete(cb);
    };
  }
}

export const webSerialManager = new WebSerialReader();
