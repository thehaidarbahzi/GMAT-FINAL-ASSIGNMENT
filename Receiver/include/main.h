#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>
#include <Wire.h>

// Custom libraries
#include "E22.h"

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
extern E22 lora;

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeLoRa();
void receiveData();

#endif