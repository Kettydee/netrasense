/*
 * NetraSense Safe Acoustic Sonar Controller
 * 
 * Gentle, Non-Ear-Piercing Proximity Radar:
 *   - Under 1 Meter (< 100 cm):
 *       RAPID PULSES: beep - pause - beep - pause (60ms on, 55ms off, 1200 Hz).
 *       Safe for piezo buzzers — NO solid continuous ringing!
 *   - 1 Meter to 2 Meters (100 cm - 200 cm):
 *       MODERATE PULSES: beep - pause - beep (70ms on, 160ms off, 950 Hz).
 *   - 2 Meters to 3 Meters (200 cm - 300 cm):
 *       SLOW GENTLE BEEPS: (80ms on, 450ms off, 800 Hz).
 *   - Above 3 Meters / Clear Pathway (> 300 cm):
 *       COMPLETELY SILENT (OFF).
 *
 * Serial protocol (USB telemetry):
 *   Valid measurement:   {"distance_cm":123.4,"valid":true}
 *   Failed measurement:  {"distance_cm":null,"valid":false,"status":"NO_ECHO"}
 *                        {"distance_cm":null,"valid":false,"status":"OUT_OF_RANGE"}
 *   A failed ultrasonic measurement (no echo / out of range) is NEVER reported
 *   as a distance value, so the host can distinguish "path is clear" from
 *   "sensor could not measure". The host keeps the last valid reading as
 *   historical data with its original timestamp.
 *
 * Pin Connections:
 *   HC-SR04 VCC  -> Arduino 5V
 *   HC-SR04 GND  -> Arduino GND
 *   HC-SR04 TRIG -> Arduino Digital Pin 9 (D9)
 *   HC-SR04 ECHO -> Arduino Digital Pin 10 (D10)
 *   BUZZER (+)   -> Arduino Digital Pin 11 (D11)
 *   BUZZER (-)   -> Arduino GND
 */

const byte TRIG_PIN = 9;
const byte ECHO_PIN = 10;
const byte BUZZER_PIN = 11;

// Ultrasonic parameters
const unsigned long ECHO_TIMEOUT_US = 24000UL;
const unsigned long SAMPLE_RATE_MS = 75UL;

// Buzzer timing
unsigned long lastBuzzerToggle = 0;
unsigned long lastSampleTime = 0;
bool buzzerState = false;
int buzzerPattern = 0; // 0=Silent, 1=Slow, 2=Moderate, 3=Rapid

// Comfortable, non-screeching tone frequency (Hz)
unsigned int currentToneFreq = 950;

void buzzerOn(unsigned int freq) {
  digitalWrite(BUZZER_PIN, HIGH);
  tone(BUZZER_PIN, freq);
}

void buzzerOff() {
  noTone(BUZZER_PIN);
  digitalWrite(BUZZER_PIN, LOW);
}

// Measurement outcomes
const byte MEASURE_OK = 0;
const byte MEASURE_NO_ECHO = 1;
const byte MEASURE_OUT_OF_RANGE = 2;

// Single ultrasonic ping. Returns MEASURE_OK only for a genuine echo inside the
// physical range; otherwise reports WHY the measurement failed instead of
// substituting a fabricated distance (the old 400.0 cm sentinel).
byte measureSinglePulse(float* outDistanceCm) {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long durationUs = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
  if (durationUs == 0) return MEASURE_NO_ECHO; // timeout: no echo received
  float dist = (float)durationUs * 0.0343f / 2.0f;
  if (dist < 2.0f || dist > 380.0f) return MEASURE_OUT_OF_RANGE;
  *outDistanceCm = dist;
  return MEASURE_OK;
}

// Non-blocking pulsed buzzer state machine (ALWAYS has pauses — NO continuous tone!)
void updateBuzzer(unsigned long now) {
  switch (buzzerPattern) {
    case 0: // SILENT (> 3m or Clear)
      if (buzzerState) {
        buzzerOff();
        buzzerState = false;
      }
      break;

    case 1: // SLOW GENTLE BEEPS (2m - 3m): 80ms on, 450ms pause
      if (buzzerState) {
        if (now - lastBuzzerToggle >= 80) {
          buzzerOff();
          buzzerState = false;
          lastBuzzerToggle = now;
        }
      } else {
        if (now - lastBuzzerToggle >= 450) {
          buzzerOn(currentToneFreq);
          buzzerState = true;
          lastBuzzerToggle = now;
        }
      }
      break;

    case 2: // MODERATE BEEPS (1m - 2m): 70ms on, 160ms pause
      if (buzzerState) {
        if (now - lastBuzzerToggle >= 70) {
          buzzerOff();
          buzzerState = false;
          lastBuzzerToggle = now;
        }
      } else {
        if (now - lastBuzzerToggle >= 160) {
          buzzerOn(currentToneFreq);
          buzzerState = true;
          lastBuzzerToggle = now;
        }
      }
      break;

    case 3: // RAPID URGENT BEEPS (< 1m): 60ms on, 55ms pause (beep-pause-beep-pause)
      if (buzzerState) {
        if (now - lastBuzzerToggle >= 60) {
          buzzerOff();
          buzzerState = false;
          lastBuzzerToggle = now;
        }
      } else {
        if (now - lastBuzzerToggle >= 55) {
          buzzerOn(currentToneFreq);
          buzzerState = true;
          lastBuzzerToggle = now;
        }
      }
      break;
  }
}

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  buzzerOff();
}

void loop() {
  unsigned long now = millis();

  // 1. Periodic ultrasonic distance measurement
  if (now - lastSampleTime >= SAMPLE_RATE_MS) {
    lastSampleTime = now;

    float distanceCm = 0.0f;
    byte result = measureSinglePulse(&distanceCm);

    if (result == MEASURE_OK) {
      // Broadcast live telemetry over USB to Dashboard
      Serial.print("{\"distance_cm\":");
      Serial.print(distanceCm, 1);
      Serial.println(",\"valid\":true}");

      // 2. Safe, pleasant sound frequencies & rhythms:
      if (distanceCm > 300.0f) {
        buzzerPattern = 0; // > 3 Meters -> Completely SILENT
      } else if (distanceCm >= 200.0f) {
        buzzerPattern = 1; // 2m - 3m -> Slow beeps
        currentToneFreq = 800; // Gentle 800 Hz
      } else if (distanceCm >= 100.0f) {
        buzzerPattern = 2; // 1m - 2m -> Moderate beeps
        currentToneFreq = 980; // Clear 980 Hz
      } else {
        buzzerPattern = 3; // < 1 Meter -> Rapid urgent beep-pause-beep
        currentToneFreq = 1200; // Crisp 1200 Hz (NOT screeching)
      }
    } else {
      // Failed measurement: report an explicit failure status, never a distance.
      // The previous buzzer pattern is kept (unknown distance must not be
      // reported as a clear/safe path).
      if (result == MEASURE_NO_ECHO) {
        Serial.println("{\"distance_cm\":null,\"valid\":false,\"status\":\"NO_ECHO\"}");
      } else {
        Serial.println("{\"distance_cm\":null,\"valid\":false,\"status\":\"OUT_OF_RANGE\"}");
      }
    }
  }

  // 3. Maintain millisecond-accurate pulsing
  updateBuzzer(now);
}
