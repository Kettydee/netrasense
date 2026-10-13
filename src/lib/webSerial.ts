// Web Serial API manager for direct in-browser Arduino communication
// Zero Python backend required! Works directly in Google Chrome, Edge, and Brave.

export type WebSerialReading = {
  distance_cm: number;
  threat_level: "NORMAL" | "WARNING" | "ALARM" | "CRITICAL";
  timestamp: string;
};

export class WebSerialReader {
  private port: any = null;
  private reader: any = null;
  private isReading = false;
  private onReadingCallback: ((reading: WebSerialReading) => void) | null = null;
  private onStatusCallback: ((connected: boolean, error?: string) => void) | null = null;

  public isSupported(): boolean {
    return typeof window !== "undefined" && "serial" in navigator;
  }

  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      alert("Web Serial is not supported in this browser. Please use Google Chrome, Brave, or Microsoft Edge.");
      return false;
    }

    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port.open({ baudRate: 9600 });
      this.isReading = true;
      this.onStatusCallback?.(true);

      // Read continuously
      this.readLoop();
      return true;
    } catch (err: any) {
      this.isReading = false;
      this.onStatusCallback?.(false, err?.message || "Failed to connect to USB device");
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.isReading = false;
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
      }
      if (this.port) {
        await this.port.close();
      }
    } catch {
      // ignore
    } finally {
      this.port = null;
      this.reader = null;
      this.onStatusCallback?.(false);
    }
  }

  private async readLoop() {
    let buffer = "";

    while (this.isReading && this.port && this.port.readable) {
      try {
        const textDecoder = new TextDecoderStream();
        this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
        this.reader = textDecoder.readable.getReader();

        while (this.isReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              this.parseLine(trimmed);
            }
          }
        }
      } catch (err: any) {
        if (this.isReading) {
          this.onStatusCallback?.(false, err?.message);
        }
        break;
      }
    }
  }

  private parseLine(line: string) {
    try {
      let distance: number | null = null;
      if (line.startsWith("{") && line.endsWith("}")) {
        const data = JSON.parse(line);
        if (typeof data.distance_cm === "number") {
          distance = data.distance_cm;
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

        this.onReadingCallback?.({
          distance_cm: Math.round(distance),
          threat_level: threat,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // ignore malformed lines
    }
  }

  public onReading(cb: (reading: WebSerialReading) => void) {
    this.onReadingCallback = cb;
  }

  public onStatus(cb: (connected: boolean, error?: string) => void) {
    this.onStatusCallback = cb;
  }
}

export const webSerialManager = new WebSerialReader();
