#include "E22.h"
#include <cstring>

// Timing configuration
static constexpr uint32_t E22_READY_TIMEOUT_MS = 3000;
static constexpr uint32_t E22_MODE_SWITCH_MS = 15;
static constexpr uint32_t E22_MODE_SETTLE_MS = 30;

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
    baudrate(9600),
    initialized(false)
{}

// Initialize module
bool E22::begin(uint32_t baudrate) {
    if (uart == nullptr) {
        initialized = false;
        return false;
    }

    this->baudrate = baudrate;
    initialized = false;

    // Configure GPIO pins
    pinMode(m0Pin, OUTPUT);
    pinMode(m1Pin, OUTPUT);
    pinMode(auxPin, INPUT);

    // Set initial mode to normal
    digitalWrite(m0Pin, LOW);
    digitalWrite(m1Pin, LOW);

    // Initialize UART communication
    uart->begin(baudrate, SERIAL_8N1, rxPin, txPin);

    // Wait for module initialization
    if (!waitUntilReady(E22_READY_TIMEOUT_MS)) {
        return false;
    }

    // Set normal operating mode
    if (!setNormalMode()) {
        return false;
    }

    initialized = true;

    return true;
}

// Set normal operating mode
bool E22::setNormalMode() {
    if (uart == nullptr) {
        return false;
    }

    // M0 = LOW, M1 = LOW
    digitalWrite(m0Pin, LOW);
    digitalWrite(m1Pin, LOW);

    delay(E22_MODE_SWITCH_MS);

    // Wait until module is ready
    if (!waitUntilReady(E22_READY_TIMEOUT_MS)) {
        return false;
    }

    delay(E22_MODE_SETTLE_MS);

    // Clear remaining UART receive buffer
    while (uart->available() > 0) {
        uart->read();
    }

    return true;
}

// Check if the module is ready
bool E22::isReady() {
    return digitalRead(auxPin) == HIGH;
}

// Send data using C-style string
bool E22::send(const char *data) {
    if (!initialized || uart == nullptr || data == nullptr) {
        return false;
    }

    // Calculate data length
    size_t length = strlen(data);

    if (length == 0) {
        return false;
    }

    // Wait until module is ready
    if (!waitUntilReady(E22_READY_TIMEOUT_MS)) {
        return false;
    }

    // Transmit data through UART
    size_t written = uart->write(
        reinterpret_cast<const uint8_t *>(data),
        length
    );

    return written == length;
}

// Send data using Arduino String
bool E22::send(const String &data) {
    return send(data.c_str());
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
