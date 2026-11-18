#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>

// Custom libraries
#include "e22.h"
#include "protocol.h"

// E22-400T30D pin configuration
#define E22_RX_PIN 16
#define E22_TX_PIN 17
#define E22_M0_PIN 18
#define E22_M1_PIN 19
#define E22_AUX_PIN 23

// LoRa configuration (must match the transmitter)
#define LORA_CHANNEL 0x19
#define LORA_AIR_RATE 0x62
#define LORA_TX_POWER 0x03

// Timing configuration
#define SERIAL_BAUDRATE 115200
#define PACKET_GAP 40
#define SUMMARY_INTERVAL 10

// Global objects
extern E22 lora;

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeLoRa();
void receiveData();
void processPacket(const uint8_t *data, size_t length);
void printSummary();

#endif
