#ifndef E22_H
#define E22_H

#include <Arduino.h>

class E22 {
public:
    // Constructor
    E22(
        HardwareSerial *serial,
        uint8_t rxPin,
        uint8_t txPin,
        uint8_t m0Pin,
        uint8_t m1Pin,
        uint8_t auxPin
    );

    // LoRa initialization
    bool begin(uint32_t baudrate = 9600);

    // Set normal operating mode
    bool setNormalMode();

    // Check if the module is ready
    bool isReady();

    // Check if data is available
    bool available();

    // Read incoming data
    int read();

    // Read incoming data as String
    String readString();

private:
    // UART interface
    HardwareSerial *uart;

    // Pin configuration
    uint8_t rxPin;
    uint8_t txPin;
    uint8_t m0Pin;
    uint8_t m1Pin;
    uint8_t auxPin;

    // Baudrate for UART communication
    uint32_t baudrate;

    // LoRa module initialization status
    bool initialized;

    // Buffer for received data
    bool waitUntilReady(uint32_t timeout);
};

#endif