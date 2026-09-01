/*
 * NetraSense HC-SR04 + Buzzer USB serial sender/receiver
 *
 * Wiring:
 *   VCC  -> 5V
 *   GND  -> GND
 *   TRIG -> D9
 *   ECHO -> D10
 *   BUZZER -> D11 (piezo buzzer)
 *
 * For 3.3 V boards, use a voltage divider on the ECHO pin.
 *
 * Serial protocol (JSON, newline-delimited):
 *   Arduino -> Python: {"distance_cm": 73.0}
 *   Python -> Arduino: {"buzzer": "ALARM"}  (or NORMAL/WARNING/CRITICAL/OFF)
 */

const byte TRIG_PIN = 9;
const byte ECHO_PIN = 10;
const byte BUZZER_PIN = 11;
const unsigned long ECHO_TIMEOUT_US = 25000UL;
const unsigned long SAMPLE_INTERVAL_MS = 100UL;

// Buzzer timing (ms)
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;
int buzzerPattern = 0;  // 0=off, 1=slow, 2=fast, 3=continuous

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
}

// Read serial commands from Python (non-blocking)
void readSerialCommand() {
  if (Serial.available() <= 0) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  // Parse simple JSON: {"buzzer": "ALARM"}
  int idx = line.indexOf("\"buzzer\"");
  if (idx < 0) return;

  idx = line.indexOf(':', idx);
  if (idx < 0) return;

  int start = line.indexOf('\"', idx + 1);
  int end = line.indexOf('\"', start + 1);
  if (start < 0 || end < 0) return;

  String value = line.substring(start + 1, end);
  value.toUpperCase();

  if (value == "CRITICAL") {
    buzzerPattern = 3;  // continuous
  } else if (value == "ALARM") {
    buzzerPattern = 2;  // fast beep (100ms on/off)
  } else if (value == "WARNING") {
    buzzerPattern = 1;  // slow beep (300ms on/off)
  } else {
    buzzerPattern = 0;  // off (NORMAL or OFF)
  }
}

// Update buzzer based on current pattern
void updateBuzzer() {
  unsigned long now = millis();

  switch (buzzerPattern) {
    case 0:  // OFF
      digitalWrite(BUZZER_PIN, LOW);
      buzzerState = false;
      break;

    case 1:  // SLOW BEEP (300ms)
      if (now - lastBuzzerToggle >= 300) {
        buzzerState = !buzzerState;
        digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
        lastBuzzerToggle = now;
      }
      break;

    case 2:  // FAST BEEP (100ms)
      if (now - lastBuzzerToggle >= 100) {
        buzzerState = !buzzerState;
        digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
        lastBuzzerToggle = now;
      }
      break;

    case 3:  // CONTINUOUS
      digitalWrite(BUZZER_PIN, HIGH);
      buzzerState = true;
      break;
  }
}

void loop() {
  // Read commands from Python
  readSerialCommand();

  // Ultrasonic measurement
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  const unsigned long durationUs = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
  if (durationUs > 0) {
    const float distanceCm = durationUs * 0.0343f / 2.0f;
    Serial.print("{\"distance_cm\":");
    Serial.print(distanceCm, 1);
    Serial.println("}");
  }

  // Update buzzer state
  updateBuzzer();

  delay(SAMPLE_INTERVAL_MS);
}
