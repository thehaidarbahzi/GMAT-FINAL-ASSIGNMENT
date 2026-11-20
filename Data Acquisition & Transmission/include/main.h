#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>
#include <Wire.h>

// Custom libraries
#include "mpu6050.h"
#include "e22.h"
#include "protocol.h"
#include "bmp280.h"

enum LedStatus { LED_OFF, LED_SUCCESS, LED_FAILED };

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeSensors();
void readSensorData();
void initializeLoRa();
bool transmitSensorData();
void transformIMU(sensors_event_t &accel, sensors_event_t &gyro);
void readSensorDataAccumulated();
void printSensorData();
void resetAccumulator();
void calculateAverage();
void calculateRollPitch(const sensors_event_t &accel, float &roll, float &pitch);
void setStatusLed(LedStatus status);
void updateStatusLed();

#endif
