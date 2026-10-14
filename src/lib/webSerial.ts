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
    try {
      const ports = await (navigator as any).serial.getPorts();
      if (ports && ports.length > 0) {
        return await this.openPort(ports[0]);
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
      const port = await (navigator as any).serial.requestPort();
      return await this.openPort(port);
    } catch (err: any) {
      this.isReading = false;
      this.notifyStatus(false, err?.message || "Failed to connect to USB device");
      return false;
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
        await this.port.close();
      }
    } catch {
      // ignore
    } finally {
      this.port = null;
      this.reader = null;
      this.notifyStatus(false);
    }
  }

  private async readLoop() {
    let buffer = "";
    const decoder = new TextDecoder();

    while (this.isReading && this.port && this.port.readable) {
      try {
        const reader = this.port.readable.getReader();
        this.reader = reader;

        try {
          while (this.isReading) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

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
            // ignore
          }
          this.reader = null;
        }
      } catch (err: any) {
        if (this.isReading) {
          this.notifyStatus(false, err?.message);
        }
        break;
      }
    }
  }

  private parseLine(line: string) {
    try {
      let distance: number | null = null;

      // Extract JSON payload: {"distance_cm": ...}
      if (line.includes("distance_cm")) {
        const match = line.match(/\{[^}]+\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (typeof parsed.distance_cm === "number") {
            distance = parsed.distance_cm;
          }
        }
      } else {
        const num = parseFloat(line);
        if (!isNaN(num)) distance = num;
      }

      if (distance !== null && isFinite(distance)) {
        let threat: "NORMAL" | "WARNING" | "ALARM" | "CRITICAL" = "NORMAL";
        if (distance >= 300) threat = "NORMAL";
        else if (distance >= 100) threat = "WARNING";
        else if (distance >= 45) threat = "ALARM";
        else threat = "CRITICAL";

        const reading: WebSerialReading = {
          distance_cm: Math.round(distance),
          threat_level: threat,
          timestamp: new Date().toISOString(),
        };

        for (const cb of this.onReadingCallbacks) {
          try {
            cb(reading);
          } catch {
            // ignore callback errors
          }
        }
      }
    } catch {
      // ignore malformed lines
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
