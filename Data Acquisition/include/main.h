#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>
#include <Wire.h>

// Custom libraries
#include "MPU6050.h"
#include "MPU6050.h"

// Pin configuration
#define SDA_PIN 21
#define SCL_PIN 22

// Timing configuration
#define SERIAL_BAUDRATE 115200
#define SENSOR_INTERVAL 100

// Global objects
extern MPU6050 imu;

// Sensor data
extern sensors_event_t accel;
extern sensors_event_t gyro;
extern sensors_event_t temp;

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeSensors();
void readSensorData();
void printSensorData();

#endif
