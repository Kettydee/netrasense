/*
 * NetraSense HC-SR04 USB serial sender
 *
 * Wiring: VCC -> 5V, GND -> GND, TRIG -> D9, ECHO -> D10.
 * For 3.3 V boards, use a voltage divider on the ECHO pin.
 */

const byte TRIG_PIN = 9;
const byte ECHO_PIN = 10;
const unsigned long ECHO_TIMEOUT_US = 25000UL;
const unsigned long SAMPLE_INTERVAL_MS = 100UL;

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);
}

void loop() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  const unsigned long durationUs = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
  if (durationUs > 0) {
    const float distanceCm = durationUs * 0.0343f / 2.0f;
    // One newline-delimited JSON record lets the Python reader process safely.
    Serial.print("{\"distance_cm\":");
    Serial.print(distanceCm, 1);
    Serial.println("}");
  }

  delay(SAMPLE_INTERVAL_MS);
}
