// Web Serial API manager for direct in-browser Arduino communication
// Zero Python backend, zero localhost, zero terminal required!
// Works directly on https://netrasense.vercel.app in Google Chrome, Edge, and Brave.

export type WebSerialReading = {
  distance_cm: number;
  threat_level: "NORMAL" | "WARNING" | "ALARM" | "CRITICAL";
  timestamp: string;
};

type SerialPortInfo = {
  usbVendorId?: number;
};

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  getInfo?: () => SerialPortInfo;
};

type SerialApi = {
  getPorts: () => Promise<SerialPortLike[]>;
  requestPort: (options: { filters: SerialPortInfo[] }) => Promise<SerialPortLike>;
  addEventListener: (type: "connect", listener: () => void) => void;
};

type NavigatorWithSerial = Navigator & { serial?: SerialApi };

function getSerialApi(): SerialApi | undefined {
  return (navigator as NavigatorWithSerial).serial;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class WebSerialReader {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private isReading = false;
  private onReadingCallbacks = new Set<(reading: WebSerialReading) => void>();
  private onStatusCallbacks = new Set<(connected: boolean, error?: string) => void>();

  public isSupported(): boolean {
    return typeof window !== "undefined" && getSerialApi() !== undefined;
  }

  public isConnected(): boolean {
    return this.isReading;
  }

  public async autoConnectIfAuthorized(): Promise<boolean> {
    if (!this.isSupported()) return false;
    this.setupConnectListener();
    try {
      const ports = await getSerialApi()?.getPorts();
      // getPorts() can include previously authorized Bluetooth serial devices.
      // Only auto-connect when exactly one recognized USB serial adapter exists.
      const usbVendorIds = new Set([0x2341, 0x2a03, 0x1a86, 0x10c4, 0x0403, 0x2e8a]);
      const usbPorts = (ports ?? []).filter((port) => {
        const vendorId = port.getInfo?.().usbVendorId;
        return vendorId !== undefined && usbVendorIds.has(vendorId);
      });
      const [usbPort] = usbPorts;
      if (usbPorts.length === 1 && usbPort) {
        return await this.openPort(usbPort);
      }
    } catch {
      // An authorized device may have been disconnected between enumeration and opening.
      return false;
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
      const serial = getSerialApi();
      if (!serial) return false;
      const port = await serial.requestPort({
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
    } catch (err: unknown) {
      this.isReading = false;
      this.notifyStatus(false, getErrorMessage(err, "Failed to connect to USB device"));
      return false;
    }
  }

  private setupConnectListener() {
    const serial = typeof navigator !== "undefined" ? getSerialApi() : undefined;
    if (this.isSupported() && serial) {
      try {
        serial.addEventListener("connect", () => {
          void this.autoConnectIfAuthorized();
        });
      } catch {
        // A browser without connect-event support can still connect through the chooser.
      }
    }
  }

  private async openPort(selectedPort: SerialPortLike): Promise<boolean> {
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
    } catch (err: unknown) {
      this.isReading = false;
      this.notifyStatus(false, getErrorMessage(err, "Could not open serial port at 9600 baud"));
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
      // Cancellation is best-effort; port cleanup still runs below.
    }

    try {
      if (this.port) {
        await this.closePort();
      }
    } catch {
      // The port may already be closed after a physical disconnect.
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
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // A disconnected stream can release its lock automatically.
          }
          this.reader = null;
        }
      } catch (err: unknown) {
        if (this.isReading) {
          this.isReading = false;
          this.notifyStatus(false, getErrorMessage(err, "USB serial reading stopped"));
        }
        break;
      }
    }
  }

  private parseLine(line: string) {
    try {
      let rawDistance: number | null = null;
      const OK_STATUSES = ["ok", "valid", "success", "good", "active", "true"];

      // 1. JSON payload: {"distance_cm": 142.3, "valid": true} (new firmware),
      //    or legacy shapes {"distance": 142} / {"dist": 142} / {"cm": 142}.
      if (line.includes("{") && line.includes("}")) {
        const match = line.match(/\{[^}]+\}/);
        if (match) {
          try {
            const parsed: unknown = JSON.parse(match[0]);
            if (!isRecord(parsed)) return;
            // Explicit validity markers from the firmware take precedence:
            // a failed measurement must never become a distance.
            const valid = parsed["valid"] ?? parsed["is_valid"];
            const status =
              typeof parsed["status"] === "string" ? parsed["status"].trim().toLowerCase() : null;
            const flaggedValid =
              valid !== undefined && valid !== null
                ? valid === true || valid === 1 || valid === "true"
                : status === null || OK_STATUSES.includes(status);
            if (!flaggedValid) return;
            const val =
              parsed["distance_cm"] ??
              parsed["distance"] ??
              parsed["dist"] ??
              parsed["cm"] ??
              parsed["d"];
            if (val === null || val === undefined) return;
            if (typeof val === "number" && isFinite(val)) {
              rawDistance = val;
            }
          } catch {
            // Non-JSON serial lines are handled by the legacy text parsers below.
          }
        }
      }

      // 2. Explicit no-echo / out-of-range keywords mean the sensor FAILED to
      //    measure — not that the path is 400 cm clear. Drop the line.
      if (rawDistance === null && /out of range|no obstacle|clear|infinity/i.test(line)) {
        return;
      }

      // 3. Labeled text: "Distance: 142.3 cm", "Distance = 142", "dist: 142", "Sonar: 142"
      if (rawDistance === null) {
        const labeledMatch = line.match(
          /(?:distance|dist|sonar|range|obstacle)[\s:=]+([-+]?\d+(?:\.\d+)?)/i,
        );
        if (labeledMatch && labeledMatch[1]) {
          const val = parseFloat(labeledMatch[1]);
          if (!isNaN(val) && isFinite(val)) rawDistance = val;
        }
      }

      // 4. Plain number or "142 cm"
      if (rawDistance === null) {
        const simpleMatch = line.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*(?:cm)?\s*$/i);
        if (simpleMatch && simpleMatch[1]) {
          const val = parseFloat(simpleMatch[1]);
          if (!isNaN(val) && isFinite(val)) rawDistance = val;
        }
      }

      // 5. Standalone valid distance fallback
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

      // Impossible measurements (<= 0) and the legacy 400 cm no-echo sentinel
      // are dropped: an invalid reading must never be reported as a safe path.
      if (this.isInvalidDistance(rawDistance)) return;

      // Adopt the new reading only when it is a genuine, finite metric
      // distance; an invalid line never refreshes the previously published
      // distance. This preserves connection-state behaviour and prevents a
      // malformed or out-of-envelope line from making the previous reading
      // appear current again.
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
        } catch (error) {
          console.warn("Web serial reading callback failed:", error);
        }
      }
    } catch (error) {
      console.warn("Ignoring malformed web serial line:", error);
    }
  }

  /**
   * Sentinel semantics: a distance of exactly 400 cm is the legacy
   * no-echo failure marker, not a valid reading.  The browser layer must
   * therefore treat a parsed 400.0 as an invalid reading (which drops the
   * line) rather than clamping it to the sensor envelope and publishing a
   * normal-looking distance.
   */
  private isInvalidDistance(rawDistance: number): boolean {
    return rawDistance <= 0 || rawDistance >= 400;
  }

  private async closePort(): Promise<void> {
    try {
      if (this.port) await this.port.close();
    } catch {
      // The port can already be closed by a browser disconnect event.
    }
  }

  private notifyStatus(connected: boolean, error?: string) {
    for (const cb of this.onStatusCallbacks) {
      try {
        cb(connected, error);
      } catch (error) {
        console.warn("Web serial status callback failed:", error);
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
