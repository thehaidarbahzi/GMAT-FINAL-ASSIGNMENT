#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>
#include <Wire.h>

// Custom libraries
#include "mpu6050.h"
#include "e22.h"
#include "protocol.h"
#include "bmp280.h"

// MPU6050 Pin configuration
#define SDA_PIN 21
#define SCL_PIN 22

// E22-400T30D pin configuration
#define E22_RX_PIN 16
#define E22_TX_PIN 17
#define E22_M0_PIN 18
#define E22_M1_PIN 19
#define E22_AUX_PIN 23

// LED pin configuration
#define MPU_INDICATOR_PIN 5
#define BMP_INDICATOR_PIN 4
#define LORA_INDICATOR_PIN 15
#define TRANSMISSION_INDICATOR_PIN 2

#define IGNITER_PIN 26

// LoRa configuration (must match the receiver)
#define LORA_CHANNEL 0x19
#define LORA_AIR_RATE 0x62
#define LORA_TX_POWER 0x03

// Timing configuration
#define SERIAL_BAUDRATE 115200
#define TRANSMIT_INTERVAL 300
#define SENSOR_READ_INTERVAL 100

// Constant
constexpr float GRAVITY = 9.80665f;

// Global objects
extern MPU6050 imu;
extern E22 lora;

// Sensor data
extern sensors_event_t accel, gyro, temp;
extern BMP280Data baroData;
extern float roll, pitch;

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeSensors();
void readSensorData();
void initializeLoRa();
void transmitSensorData();
void transformIMU(sensors_event_t &accel, sensors_event_t &gyro);
void readSensorDataAccumulated();
void printSensorData();
void resetAccumulator();
void calculateAverage();
void calculateRollPitch(const sensors_event_t &accel, float &roll, float &pitch);

#endif
