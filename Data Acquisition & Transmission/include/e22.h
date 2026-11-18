#ifndef E22_H
#define E22_H

#include <Arduino.h>

// Maximum bytes per packet
#define E22_MAX_PACKET 240

// Radio configuration (must be identical on TX and RX)
struct E22Config {
    // Channel 25
    uint8_t channel = 0x19;

    // REG0: 9600 8N1, air rate 2.4k
    uint8_t airRate = 0x62;

    // REG1 bits 1-0: 21 dBm on E22-400T30D
    uint8_t txPower = 0x03;

    // Append RSSI byte to received packets
    bool rssiByte = true;
};

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

    // LoRa initialization (writes the configuration to the module)
    bool begin(uint32_t baudrate = 9600, const E22Config &config = E22Config());

    // Set normal operating mode
    bool setNormalMode();

    // Check if the module is ready
    bool isReady();

    // Send raw data
    bool send(const uint8_t *data, size_t length);

    // Send data using C-style string
    bool send(const char *data);

    // Send data using Arduino String
    bool send(const String &data);

    // Check if data is available
    bool available();

    // Read incoming byte
    int read();

    // RSSI byte option status
    bool rssiEnabled() const;

    // Reason of the last failed initialization
    const char *lastError() const;

    // Convert raw RSSI byte to dBm (false if the value is invalid)
    static bool rssiToDbm(uint8_t raw, int &dbm);

private:
    // UART interface
    HardwareSerial *uart;

    // Pin configuration
    uint8_t rxPin;
    uint8_t txPin;
    uint8_t m0Pin;
    uint8_t m1Pin;
    uint8_t auxPin;

    // Configuration and status
    E22Config cfg;
    bool configured;
    const char *error;

    bool waitUntilReady(uint32_t timeout);
    bool setMode(bool m0, bool m1);
    void clearBuffer();
    size_t readBytes(uint8_t *buffer, size_t length, uint32_t timeout);
    bool readConfig(uint8_t *regs);
    bool writeConfig();
};

#endif
