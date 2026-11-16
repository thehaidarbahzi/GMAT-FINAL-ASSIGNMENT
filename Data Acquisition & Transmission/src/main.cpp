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

// Sensor data
sensors_event_t accel;
sensors_event_t gyro;
sensors_event_t temp;

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
}

// Initialize LoRa
void initializeLoRa() {
    Serial.println("Initializing LoRa");

    if (lora.begin(9600)) {
        Serial.println("LoRa: OK");
    } else {
        Serial.println("LoRa: FAILED");
    }
}

// Read sensor data
void readSensorData() {
    if (imu.isInitialized()) {
        imu.getEvent(&accel, &gyro, &temp);
    }
}

// Print sensor data
void printSensorData() {
    Serial.print(id);
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
    Serial.println(gyro.gyro.z);
}

// Transmit sensor data
void transmitSensorData() {
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

    // Construct Fixed Transmission packet
    String packet;

    packet += (char)TARGET_ADDH;
    packet += (char)TARGET_ADDL;
    packet += (char)TARGET_CHANNEL;

    packet += payload;
    packet += "\n";

    // Send packet
    if (lora.send(packet)) {
        Serial.println("LoRa: Data sent");
    } else {
        Serial.println("LoRa: Transmission failed");
    }
}

// Setup
void setup() {
    initializeSerial();
    initializeSensors();
    initializeLoRa();
}

// Main loop
void loop() {
    unsigned long currentMillis = millis();

    if (currentMillis - previousMillis >= SENSOR_INTERVAL) {
        previousMillis = currentMillis;

        readSensorData();

        printSensorData();

        transmitSensorData();

        id++;
    }
}
