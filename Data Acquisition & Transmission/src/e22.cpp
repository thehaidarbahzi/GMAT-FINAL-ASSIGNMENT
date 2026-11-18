#include "e22.h"
#include <cstring>

// Timing configuration
static constexpr uint32_t E22_READY_TIMEOUT_MS = 3000;
static constexpr uint32_t E22_MODE_SWITCH_MS = 15;
static constexpr uint32_t E22_MODE_SETTLE_MS = 30;
static constexpr uint32_t E22_COMMAND_TIMEOUT_MS = 700;

// Constructor
E22::E22(
    HardwareSerial *serial,
    uint8_t rxPin,
    uint8_t txPin,
    uint8_t m0Pin,
    uint8_t m1Pin,
    uint8_t auxPin
) :
    uart(serial),
    rxPin(rxPin),
    txPin(txPin),
    m0Pin(m0Pin),
    m1Pin(m1Pin),
    auxPin(auxPin),
    configured(false),
    error("not initialized")
{}

// Initialize module
bool E22::begin(uint32_t baudrate, const E22Config &config) {
    if (uart == nullptr) {
        error = "UART is null";
        return false;
    }

    cfg = config;
    configured = false;
    error = nullptr;

    // Configure GPIO pins
    pinMode(m0Pin, OUTPUT);
    pinMode(m1Pin, OUTPUT);
    pinMode(auxPin, INPUT);

    // Configuration mode always uses 9600 8N1
    uart->begin(9600, SERIAL_8N1, rxPin, txPin);

    // Configuration mode pins differ between module variants
    static const bool modes[3][2] = {{0, 1}, {1, 1}, {1, 0}};
    bool answered = false;

    for (const auto &mode : modes) {
        setMode(mode[0], mode[1]);

        uint8_t regs[9];
        if (!readConfig(regs)) {
            continue;
        }

        answered = true;
        configured = writeConfig();
        break;
    }

    if (!answered) {
        error = "no response from module";
    } else if (!configured) {
        error = "configuration mismatch";
    }

    // Restart UART with the operating baudrate
    uart->end();
    uart->begin(baudrate, SERIAL_8N1, rxPin, txPin);

    if (!setNormalMode() && error == nullptr) {
        error = "AUX stuck LOW";
    }

    return configured;
}

// Set normal operating mode
bool E22::setNormalMode() {
    return setMode(LOW, LOW);
}

// Check if the module is ready
bool E22::isReady() {
    return digitalRead(auxPin) == HIGH;
}

// Send raw data
bool E22::send(const uint8_t *data, size_t length) {
    if (uart == nullptr || data == nullptr || length == 0 || length > E22_MAX_PACKET) {
        return false;
    }

    // Wait until module is ready
    if (!waitUntilReady(E22_READY_TIMEOUT_MS)) {
        return false;
    }

    // Transmit data through UART
    return uart->write(data, length) == length;
}

// Send data using C-style string
bool E22::send(const char *data) {
    if (data == nullptr) {
        return false;
    }

    return send(reinterpret_cast<const uint8_t *>(data), strlen(data));
}

// Send data using Arduino String
bool E22::send(const String &data) {
    return send(data.c_str());
}

// Check if incoming data is available
bool E22::available() {
    return uart != nullptr && uart->available() > 0;
}

// Read one byte from UART
int E22::read() {
    if (uart == nullptr) {
        return -1;
    }

    return uart->read();
}

// RSSI byte option status
bool E22::rssiEnabled() const {
    return cfg.rssiByte;
}

// Reason of the last failed initialization
const char *E22::lastError() const {
    return error;
}

// Convert raw RSSI byte to dBm
bool E22::rssiToDbm(uint8_t raw, int &dbm) {
    if (raw == 0) {
        return false;
    }

    dbm = -(256 - static_cast<int>(raw));

    return true;
}

// Wait until AUX pin becomes HIGH
bool E22::waitUntilReady(uint32_t timeout) {
    uint32_t startTime = millis();

    while (!isReady()) {
        if (millis() - startTime >= timeout) {
            return false;
        }

        delay(1);
    }

    return true;
}

// Set M0 and M1 pins, then wait until the module is ready
bool E22::setMode(bool m0, bool m1) {
    digitalWrite(m0Pin, m0);
    digitalWrite(m1Pin, m1);

    delay(E22_MODE_SWITCH_MS);

    bool ready = waitUntilReady(E22_READY_TIMEOUT_MS);

    delay(E22_MODE_SETTLE_MS);
    clearBuffer();

    return ready;
}

// Clear remaining UART receive buffer
void E22::clearBuffer() {
    while (uart->available() > 0) {
        uart->read();
    }
}

// Read bytes with timeout
size_t E22::readBytes(uint8_t *buffer, size_t length, uint32_t timeout) {
    size_t count = 0;
    uint32_t startTime = millis();

    while (count < length && millis() - startTime < timeout) {
        if (uart->available() > 0) {
            buffer[count++] = static_cast<uint8_t>(uart->read());
        }
    }

    return count;
}

// Read 9 configuration registers
bool E22::readConfig(uint8_t *regs) {
    const uint8_t command[] = {0xC1, 0x00, 0x09};
    uint8_t response[12];

    clearBuffer();
    uart->write(command, sizeof(command));

    if (readBytes(response, sizeof(response), E22_COMMAND_TIMEOUT_MS) != sizeof(response)) {
        return false;
    }

    if (response[0] != 0xC1 || response[1] != 0x00 || response[2] != 0x09) {
        return false;
    }

    memcpy(regs, response + 3, 9);

    return true;
}

// Write configuration temporarily (command 0xC2, rewritten on every boot)
bool E22::writeConfig() {
    // ADDH, ADDL, NETID, REG0, REG1, REG2, REG3, CRYPT_H, CRYPT_L
    uint8_t packet[12] = {
        0xC2, 0x00, 0x09,
        0x00, 0x00, 0x00,
        cfg.airRate,
        static_cast<uint8_t>(0x20 | (cfg.txPower & 0x03)),
        cfg.channel,
        static_cast<uint8_t>((cfg.rssiByte ? 0x80 : 0x00) | 0x03),
        0x00, 0x00
    };

    uint8_t response[12];

    clearBuffer();
    uart->write(packet, sizeof(packet));
    readBytes(response, sizeof(response), E22_COMMAND_TIMEOUT_MS);

    delay(50);

    // Read back and compare ADDH to REG3
    uint8_t regs[9];
    if (!readConfig(regs)) {
        return false;
    }

    return memcmp(regs, packet + 3, 7) == 0;
}
