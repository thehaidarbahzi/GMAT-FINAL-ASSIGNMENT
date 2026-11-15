#include "main.h"

// Global objects
MPU6050 imu;

// Sensor data
sensors_event_t accel;
sensors_event_t gyro;
sensors_event_t temp;

// Timing
unsigned long previousMillis = 0;
unsigned long id = 0;

void setup() {
    initializeSerial();
    initializeSensors();
}

void loop() {
    unsigned long currentMillis = millis();

    if (currentMillis - previousMillis >= SENSOR_INTERVAL) {
        previousMillis = currentMillis;

        readSensorData();
        printSensorData();
    }
}

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

// Read sensor data
void readSensorData() {
    // Read MPU6050
    if (imu.isInitialized()) {
        imu.getEvent(&accel, &gyro, &temp);
    }

}

// Print sensor data
void printSensorData() {
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
    Serial.println();

}
