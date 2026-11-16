#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>
#include <Wire.h>

// Custom libraries
#include "MPU6050.h"
#include "E22.h"

// MPU6050 Pin configuration
#define SDA_PIN 21
#define SCL_PIN 22

// E22-400T30D pin configuration
#define E22_RX_PIN 16
#define E22_TX_PIN 17
#define E22_M0_PIN 18
#define E22_M1_PIN 19
#define E22_AUX_PIN 23

// Header payload 
#define TARGET_ADDH 0xFF
#define TARGET_ADDL 0xFF
#define TARGET_CHANNEL 0x19

// Timing configuration
#define SERIAL_BAUDRATE 115200
#define SENSOR_INTERVAL 100

// Global objects
extern MPU6050 imu;
extern E22 lora;

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
void initializeLoRa();
void transmitSensorData();

#endif
