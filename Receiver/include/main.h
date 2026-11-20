#ifndef MAIN_H
#define MAIN_H

#include <Arduino.h>

// Custom libraries
#include "e22.h"
#include "protocol.h"

// Function prototypes
void setup();
void loop();

void initializeSerial();
void initializeLoRa();
void receiveData();
void processPacket(const uint8_t *data, size_t length);
void printSummary();

#endif
