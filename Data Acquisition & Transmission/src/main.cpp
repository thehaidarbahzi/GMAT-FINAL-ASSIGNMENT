#include "main.h"

// MPU6050 Pin configuration
#define SDA_PIN 21
#define SCL_PIN 22

// E22-400T30D pin configuration
#define E22_RX_PIN 16 // To LoRa TX
#define E22_TX_PIN 17 // To LoRa RX
#define E22_M0_PIN 18
#define E22_M1_PIN 19
#define E22_AUX_PIN 23

// LED pin configuration
#define MPU_INDICATOR_PIN 13
#define BMP_INDICATOR_PIN 14
#define LORA_INDICATOR_PIN 26
#define BLUE_LED_PIN 27
#define RED_LED_PIN 33

#define IGNITER_PIN 25

// Calibration configuration
#define CALIBRATION_SAMPLES 200
#define CALIBRATION_INTERVAL 10

// Roll and pitch offset
float rollOffset = 0.0f;
float pitchOffset = 0.0f;

// Transmission Indicator State
LedStatus transmissionIndicator = LED_OFF;

// LED timing configuration
constexpr unsigned long LED_BLINK_INTERVAL_MS = 150;

unsigned long ledEventMillis = 0;
bool blinkState = false;

// LoRa configuration (must match the receiver)
#define LORA_CHANNEL 0x19
#define LORA_AIR_RATE 0xE4
#define LORA_TX_POWER 0x01
#define LORA_UART_BAUD 115200

// Timing configuration
#define SERIAL_BAUDRATE 115200
#define TRANSMIT_INTERVAL 200
#define SENSOR_READ_INTERVAL 100

// Constant
constexpr float GRAVITY = 9.80665f;
const float ALPHA = 0.98;
float filtRoll = 0, filtPitch = 0;
unsigned long lastTime = 0;

// Global objects
MPU6050 imu;
E22 lora(
    &Serial2,
    E22_RX_PIN,
    E22_TX_PIN,
    E22_M0_PIN,
    E22_M1_PIN,
    E22_AUX_PIN
);
BMP280 baro;

// Sensor data
sensors_event_t accel = {};
sensors_event_t gyro = {};
sensors_event_t temp = {};
BMP280Data baroData = {};
float roll, pitch;

// Timing and Scheduling
unsigned long previousMillis = 0;
uint32_t batchPeriod = TRANSMIT_INTERVAL / SENSOR_READ_INTERVAL;

// Packet Management
unsigned long packetID = 0;
uint32_t readCount = 0;
bool batchReady = false;



// Initialize serial communication
void initializeSerial() {
    Serial.begin(SERIAL_BAUDRATE);
    delay(500);

    Serial.println("Rocket Payload System");
}

// Initialize I2C and sensors
void initializeSensors() {
    Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(400000);

    Serial.println("Initializing sensors");

    digitalWrite(MPU_INDICATOR_PIN, HIGH);
    delay(1000);
    digitalWrite(MPU_INDICATOR_PIN, LOW);
    delay(750);
    if (imu.begin(&Wire)) {
        Serial.println("MPU6050: OK");
        digitalWrite(MPU_INDICATOR_PIN, HIGH);
        delay(1000);
    } else {
        Serial.println("MPU6050: FAILED");
        while (true) {
            digitalWrite(MPU_INDICATOR_PIN, HIGH);
            delay(500);
            digitalWrite(MPU_INDICATOR_PIN, LOW);
            delay(500);
        }
    }

    digitalWrite(BMP_INDICATOR_PIN, HIGH);
    delay(1000);
    digitalWrite(BMP_INDICATOR_PIN, LOW);
    delay(750);
    if (baro.begin(&Wire)) {
        Serial.println("BMP280: OK");
        digitalWrite(BMP_INDICATOR_PIN, HIGH);
        delay(1000);
    } else {
        Serial.println("BMP280: FAILED");
        while (true) {
            digitalWrite(BMP_INDICATOR_PIN, HIGH);
            delay(500);
            digitalWrite(BMP_INDICATOR_PIN, LOW);
            delay(500);
        }
    }

}

// Read sensor data
void readSensorData() {
    // Read MPU6050
    if (imu.isInitialized()) {
        imu.getEvent(&accel, &gyro, &temp);
    }

    // Transform sensor coordinate frame to mount coordinate frame
    transformIMU(accel, gyro);

    // Read BMP280
    if (baro.isInitialized()) {
        baro.readData(&baroData);
    }
}

// Initialize LoRa
void initializeLoRa() {
    Serial.println("Initializing LoRa");

    digitalWrite(LORA_INDICATOR_PIN, HIGH);
    delay(1000);
    digitalWrite(LORA_INDICATOR_PIN, LOW);
    delay(750);

    E22Config config;
    config.channel = LORA_CHANNEL;
    config.airRate = LORA_AIR_RATE;
    config.txPower = LORA_TX_POWER;

    if (lora.begin(LORA_UART_BAUD, config)) {
        Serial.println("LoRa: OK");
        digitalWrite(LORA_INDICATOR_PIN, HIGH);
        delay(1000);
    } else {
        Serial.print("LoRa: FAILED (");
        Serial.print(lora.lastError());
        Serial.println(")");
        while (true) {
            digitalWrite(LORA_INDICATOR_PIN, HIGH);
            delay(500);
            digitalWrite(LORA_INDICATOR_PIN, LOW);
            delay(500);
        }
    }
}

// Transmit sensor data
bool transmitSensorData() {
    // Skip if the module is still sending the previous packet
    if (!lora.isReady()) {
        Serial.println("LoRa: Module busy");
        return false;
    }

    // Construct payload
    String payload = "";

    payload += String(packetID);
    payload += ",";
    payload += String(millis());
    payload += ",";
    payload += String(accel.acceleration.x / GRAVITY, 3);
    payload += ",";
    payload += String(accel.acceleration.y / GRAVITY, 3);
    payload += ",";
    payload += String(accel.acceleration.z / GRAVITY, 3);
    payload += ",";
    payload += String(gyro.gyro.x , 3);
    payload += ",";
    payload += String(gyro.gyro.y, 3);
    payload += ",";
    payload += String(gyro.gyro.z, 3);
    payload += ",";
    payload += String(temp.temperature, 3);
    payload += ",";
    payload += String(baroData.temperature, 3);
    payload += ",";
    payload += String(baroData.pressure, 3);
    payload += ",";
    payload += String(baroData.altitude, 3);
    payload += ",";
    payload += String(roll, 3);
    payload += ",";
    payload += String(pitch, 3);

    // Send packet
    bool transmissionStatus = lora.send(buildPacket(payload));

    if (transmissionStatus) {
        Serial.print("LoRa: Data sent ");
        Serial.println(payload);
        setStatusLed(LED_SUCCESS);
    } else {
        Serial.println("LoRa: Transmission failed");
        setStatusLed(LED_FAILED);
    }

    return transmissionStatus;
}

// Set LED status
void setStatusLed(LedStatus status) {
    // Keep the current blink running if the status remains unchanged
    if (status == transmissionIndicator) {
        return;
    }

    transmissionIndicator = status;
    ledEventMillis = millis();
    blinkState = true;
}

// Update LED without blocking
void updateStatusLed() {
    unsigned long now = millis();

    switch (transmissionIndicator) {

        case LED_SUCCESS:
        case LED_FAILED:

            if (now - ledEventMillis >= LED_BLINK_INTERVAL_MS) {
                ledEventMillis = now;
                blinkState = !blinkState;
            }

            if (transmissionIndicator == LED_SUCCESS) {
                // Purple
                digitalWrite(RED_LED_PIN, blinkState);
                digitalWrite(BLUE_LED_PIN, blinkState);
            } else {
                // Red
                digitalWrite(BLUE_LED_PIN, LOW);
                digitalWrite(RED_LED_PIN, blinkState);
            }

            break;

        case LED_OFF:
        default:
            digitalWrite(RED_LED_PIN, LOW);
            digitalWrite(BLUE_LED_PIN, LOW);
            break;
    }
}

// Coordinate transformation due to module placement
void transformIMU(sensors_event_t &accel,sensors_event_t &gyro) {
    float temp_axis;

    // Accelerometer
    temp_axis = accel.acceleration.x;
    accel.acceleration.x = accel.acceleration.z;
    accel.acceleration.z = -temp_axis;

    // Gyroscope
    temp_axis = gyro.gyro.x;
    gyro.gyro.x = gyro.gyro.z;
    gyro.gyro.z = -temp_axis;
}

void readSensorDataAccumulated() {
    sensors_event_t sampleAccel = {};
    sensors_event_t sampleGyro = {};
    sensors_event_t sampleTemperature = {};

    if (imu.isInitialized()) {
        imu.getEvent(
            &sampleAccel,
            &sampleGyro,
            &sampleTemperature
        );

        // Transform latest sample
        transformIMU(sampleAccel, sampleGyro);

        // Accumulate accelerometer
        accel.acceleration.x += sampleAccel.acceleration.x;
        accel.acceleration.y += sampleAccel.acceleration.y;
        accel.acceleration.z += sampleAccel.acceleration.z;

        // Accumulate gyroscope
        gyro.gyro.x += sampleGyro.gyro.x;
        gyro.gyro.y += sampleGyro.gyro.y;
        gyro.gyro.z += sampleGyro.gyro.z;

        // Accumulate temperature
        temp.temperature += sampleTemperature.temperature;
    }
    BMP280Data sampleBaroData = {};

    if (baro.isInitialized()) {
        baro.readData(&sampleBaroData);

        baroData.temperature += sampleBaroData.temperature;
        baroData.pressure += sampleBaroData.pressure;
        baroData.altitude += sampleBaroData.altitude;
    }
}

void printSensorData() {
    String data = "";
    data += String(packetID);
    data += ",";
    data += String(millis());
    data += ",";
    data += String(accel.acceleration.x / GRAVITY, 3);
    data += ",";
    data += String(accel.acceleration.y / GRAVITY, 3);
    data += ",";
    data += String(accel.acceleration.z / GRAVITY, 3);
    data += ",";
    data += String(gyro.gyro.x, 3);
    data += ",";
    data += String(gyro.gyro.y, 3);
    data += ",";
    data += String(gyro.gyro.z, 3);
    data += ",";
    data += String(temp.temperature, 3);
    data += ",";
    data += String(baroData.temperature, 3);
    data += ",";
    data += String(baroData.pressure, 3);
    data += ",";
    data += String(baroData.altitude, 3);
    data += ",";
    data += String(roll, 3);
    data += ",";
    data += String(pitch, 3);

    Serial.println(data);

}

void resetAccumulator() {
    accel = {};
    gyro = {};
    temp = {};
    baroData = {};

    readCount = 0;
}

void calculateAverage() {
    float divisor = (float)readCount;

    accel.acceleration.x /= divisor;
    accel.acceleration.y /= divisor;
    accel.acceleration.z /= divisor;

    gyro.gyro.x /= divisor;
    gyro.gyro.y /= divisor;
    gyro.gyro.z /= divisor;

    temp.temperature /= divisor;

    baroData.temperature /= divisor;
    baroData.pressure /= divisor;
    baroData.altitude /= divisor;
}

// Calculate roll and pitch using complementary filter
void calculateRollPitch(const sensors_event_t &accel, const sensors_event_t &gyro, float &roll, float &pitch) {
    float accRoll = atan2(accel.acceleration.y, accel.acceleration.z) * 180.0 / PI;
    float accPitch = atan2(-accel.acceleration.x,
                     sqrt(accel.acceleration.y * accel.acceleration.y +
                          accel.acceleration.z * accel.acceleration.z)) * 180.0 / PI;

    unsigned long now = micros();
    float dt = (now - lastTime) / 1000000.0;
    lastTime = now;

    filtRoll  = ALPHA * (filtRoll  + gyro.gyro.x * 180.0 / PI * dt) + (1 - ALPHA) * accRoll;
    filtPitch = ALPHA * (filtPitch + gyro.gyro.y * 180.0 / PI * dt) + (1 - ALPHA) * accPitch;

    roll = filtRoll;
    pitch = filtPitch;
}

// Calibrate initial roll and pitch offset while the rocket is stationary
void calibrateRollPitch() {
    Serial.println("Calibrating roll and pitch, keep the rocket still");

    sensors_event_t sampleAccel = {};
    sensors_event_t sampleGyro = {};
    sensors_event_t sampleTemperature = {};
    sensors_event_t averageAccel = {};

    float sumX = 0.0f;
    float sumY = 0.0f;
    float sumZ = 0.0f;

    for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
        imu.getEvent(&sampleAccel, &sampleGyro, &sampleTemperature);

        // Transform sensor coordinate frame to mount coordinate frame
        transformIMU(sampleAccel, sampleGyro);

        sumX += sampleAccel.acceleration.x;
        sumY += sampleAccel.acceleration.y;
        sumZ += sampleAccel.acceleration.z;

        delay(CALIBRATION_INTERVAL);
    }

    // Average accelerometer
    averageAccel.acceleration.x = sumX / CALIBRATION_SAMPLES;
    averageAccel.acceleration.y = sumY / CALIBRATION_SAMPLES;
    averageAccel.acceleration.z = sumZ / CALIBRATION_SAMPLES;

    // Store initial angle as offset
    calculateAccelRollPitch(averageAccel, rollOffset, pitchOffset);

    Serial.print("Calibration: OK (roll offset ");
    Serial.print(rollOffset, 3);
    Serial.print(", pitch offset ");
    Serial.print(pitchOffset, 3);
    Serial.println(")");
}

// Setup
void setup() {
    pinMode(MPU_INDICATOR_PIN, OUTPUT);
    pinMode(BMP_INDICATOR_PIN, OUTPUT);
    pinMode(LORA_INDICATOR_PIN, OUTPUT);
    pinMode(BLUE_LED_PIN, OUTPUT);
    pinMode(RED_LED_PIN, OUTPUT);

    initializeSerial();
    initializeSensors();
    initializeLoRa();
    calibrateRollPitch();

    // Start the filter from the calibrated orientation
    filtRoll = rollOffset;
    filtPitch = pitchOffset;
    lastTime = micros();
}


// Main loop
void loop() {
    unsigned long currentMillis = millis();

    // Update transmission indicator
    updateStatusLed();

    if (currentMillis - previousMillis >= SENSOR_READ_INTERVAL) {

        // Keep a fixed schedule to avoid timing drift
        previousMillis += SENSOR_READ_INTERVAL;

        // Skip sampling while the batch is waiting to be transmitted
        if (!batchReady) {

            // Acquire sensor data
            readSensorDataAccumulated();

            // Count samples
            readCount++;

            // Check transmission interval
            if (readCount >= batchPeriod) {

                // Calculate average
                calculateAverage();

                // Calculate roll and pitch once per batch
                calculateRollPitch(accel, gyro, roll, pitch);

                // Apply calibration offset
                roll -= rollOffset;
                pitch -= pitchOffset;

                // Keep roll within -180 to 180
                if (roll > 180.0f) roll -= 360.0f;
                else if (roll < -180.0f) roll += 360.0f;

                // Print averaged data
                // printSensorData();

                batchReady = true;
            }
        }
    }

    // Transmit data when LoRa is ready
    if (batchReady && lora.isReady()) {

        if (transmitSensorData()) {

            // Increment batch ID
            packetID++;

            // Reset accumulator
            resetAccumulator();

            batchReady = false;
        }
    }
}