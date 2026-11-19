#include "main.h"

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

// Timing
unsigned long previousMillis = 0;
unsigned long packetID = 0;
uint32_t readCount = 0;
uint32_t batchPeriod = TRANSMIT_INTERVAL / SENSOR_READ_INTERVAL;
boolean blinkState = true;

// Initialize serial communication
void initializeSerial() {
    Serial.begin(SERIAL_BAUDRATE);
    delay(500);

    Serial.println("Rocket Payload System");
}

// Initialize I2C and sensors
void initializeSensors() {
    Wire.begin(SDA_PIN, SCL_PIN);

    Serial.println("Initializing sensors");

    digitalWrite(MPU_INDICATOR_PIN, HIGH);
    delay(1000);
    digitalWrite(MPU_INDICATOR_PIN, LOW);
    delay(750);
    if (imu.begin(&Wire)) {
        Serial.println("MPU6050: OK");
        digitalWrite(MPU_INDICATOR_PIN, HIGH);
    } else {
        Serial.println("MPU6050: FAILED");
        while (true) {
            digitalWrite(MPU_INDICATOR_PIN, HIGH);
            delay(500);
            digitalWrite(MPU_INDICATOR_PIN, LOW);
            delay(500);
        }
    }

    // delay(1000);
    // digitalWrite(BMP_INDICATOR_PIN, HIGH);
    // delay(1000);
    // digitalWrite(BMP_INDICATOR_PIN, LOW);
    // delay(750);
    // if (baro.begin(&Wire)) {
    //     Serial.println("BMP280: OK");
    //     digitalWrite(BMP_INDICATOR_PIN, HIGH);
    // } else {
    //     Serial.println("BMP280: FAILED");
    //     while (true) {
    //         digitalWrite(BMP_INDICATOR_PIN, HIGH);
    //         delay(500);
    //         digitalWrite(BMP_INDICATOR_PIN, LOW);
    //         delay(500);
    //     }
    // }

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

    if (lora.begin(9600, config)) {
        Serial.println("LoRa: OK");
        digitalWrite(LORA_INDICATOR_PIN, HIGH);
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
void transmitSensorData() {
    // Skip if the module is still sending the previous packet
    if (!lora.isReady()) {
        Serial.println("LoRa: Module busy");
        return;
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

    // Send packet
    if (lora.send(buildPacket(payload))) {
        Serial.print("LoRa: Data sent ");
        Serial.println(payload);
    } else {
        Serial.println("LoRa: Transmission failed");
    }
}

// Coordinate transformation due to module placement
void transformIMU(sensors_event_t &accel,sensors_event_t &gyro) {
    float temp_axis;

    // Accelerometer
    temp_axis = accel.acceleration.y;
    accel.acceleration.y = -accel.acceleration.z;
    accel.acceleration.z = temp_axis;

    // Gyroscope
    temp_axis = gyro.gyro.y;
    gyro.gyro.y = -gyro.gyro.z;
    gyro.gyro.z = temp_axis;
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

void calculateRollPitch(const sensors_event_t &accel, float &roll, float &pitch) {
    roll = atan2(
    accel.acceleration.y,
    accel.acceleration.z
) * 180.0 / PI;
    pitch = atan2(
        -accel.acceleration.x, 
        sqrt(accel.acceleration.y * accel.acceleration.y + accel.acceleration.z * accel.acceleration.z)
    ) * 180.0 / PI;
}

// Setup
void setup() {
    pinMode(MPU_INDICATOR_PIN, OUTPUT);
    pinMode(BMP_INDICATOR_PIN, OUTPUT);
    pinMode(LORA_INDICATOR_PIN, OUTPUT);
    pinMode(TRANSMISSION_INDICATOR_PIN, OUTPUT);

    initializeSerial();
    initializeSensors();
    // initializeLoRa();
}

// Main loop
void loop() {
    unsigned long currentMillis = millis();

    if (currentMillis - previousMillis >= SENSOR_READ_INTERVAL) {
        previousMillis = currentMillis;

        // Acquire sensor data
        readSensorDataAccumulated();

        // Count samples
        readCount++;

        // Check transmission interval
        if (readCount >= batchPeriod) {

            // Calculate average
            calculateAverage();

            // Calculate roll and pitch
            calculateRollPitch(accel, roll, pitch);

            // Print averaged data
            printSensorData();
            // transmitSensorData();

            // Blink indicator
            digitalWrite(TRANSMISSION_INDICATOR_PIN, !blinkState);
            blinkState = !blinkState;

            // Increment batch ID
            packetID++;

            // Reset accumulator
            resetAccumulator();
        }
    }
}
