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
sensors_event_t accel;
sensors_event_t gyro;
sensors_event_t temp;
BMP280Data baroData = {};

// Timing
unsigned long previousMillis = 0;
unsigned long id = 0;

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

    if (imu.begin(&Wire)) {
        Serial.println("MPU6050: OK");
    } else {
        Serial.println("MPU6050: FAILED");
    }

    if (baro.begin(&Wire)) {
        Serial.println("BMP280: OK");
    } else {
        Serial.println("BMP280: FAILED");
    }

}

// Read sensor data
void readSensorData() {
    // Read MPU6050
    if (imu.isInitialized()) {
        imu.getEvent(&accel, &gyro, &temp);
    }

    // coordinate transformation due to module placement
    // MPU6050 mounting rotation: -90 degrees around X-axis

    // Accelerometer
    float temp_axis;
    temp_axis = accel.acceleration.y;
    accel.acceleration.y = -accel.acceleration.z;
    accel.acceleration.z = temp_axis;
    // Gyroscope
    temp_axis = gyro.gyro.y;
    gyro.gyro.y = -gyro.gyro.z;
    gyro.gyro.z = temp_axis;


    // Read BMP280
    if (baro.isInitialized()) {
        baro.readData(&baroData);
    }
}

// Initialize LoRa
void initializeLoRa() {
    Serial.println("Initializing LoRa");

    E22Config config;
    config.channel = LORA_CHANNEL;
    config.airRate = LORA_AIR_RATE;
    config.txPower = LORA_TX_POWER;

    if (lora.begin(9600, config)) {
        Serial.println("LoRa: OK");
    } else {
        Serial.print("LoRa: FAILED (");
        Serial.print(lora.lastError());
        Serial.println(")");
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

    payload += String(id);
    payload += ",";
    payload += String(millis());
    payload += ",";
    payload += String(accel.acceleration.x, 3);
    payload += ",";
    payload += String(accel.acceleration.y, 3);
    payload += ",";
    payload += String(accel.acceleration.z, 3);
    payload += ",";
    payload += String(gyro.gyro.x, 3);
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
        id++;
    } else {
        Serial.println("LoRa: Transmission failed");
    }
}

// Setup
void setup() {
    initializeSerial();
    initializeSensors();
    // initializeLoRa();
}

// Main loop
void loop() {
    unsigned long currentMillis = millis();

    if (currentMillis - previousMillis >= TRANSMIT_INTERVAL) {
        previousMillis = currentMillis;

        readSensorData();
        // transmitSensorData();
        Serial.print(id++);
    Serial.print(",");
    Serial.print(millis());
    Serial.print(",");
    Serial.print(accel.acceleration.x);
    Serial.print(",");
    Serial.print(accel.acceleration.y);
    Serial.print(",");
    Serial.print(accel.acceleration.z);
    Serial.print(",");
    Serial.print(gyro.gyro.x);
    Serial.print(",");
    Serial.print(gyro.gyro.y);
    Serial.print(",");
    Serial.print(gyro.gyro.z);
    Serial.print(",");
    Serial.print(temp.temperature);
    Serial.print(",");
    Serial.print(baroData.temperature);
    Serial.print(",");
    Serial.print(baroData.pressure);
    Serial.print(",");
    Serial.println(baroData.altitude);
    }
}
