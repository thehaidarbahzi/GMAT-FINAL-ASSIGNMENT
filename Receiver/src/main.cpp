#include "main.h"

// Global LoRa object
E22 lora(
    &Serial2,
    E22_RX_PIN,
    E22_TX_PIN,
    E22_M0_PIN,
    E22_M1_PIN,
    E22_AUX_PIN
);

// Receive buffer
static String receiveBuffer = "";

// Timing
unsigned long previousMillis = 0;

// Setup
void setup() {
    initializeSerial();
    initializeLoRa();

    Serial.println("Ground Control Station Initialized");
    Serial.println("Waiting for incoming data");
}

// Main loop
void loop() {
    receiveData();
}

// Initialize Serial Monitor
void initializeSerial() {
    Serial.begin(SERIAL_BAUDRATE);

    delay(500);

    Serial.println();
    Serial.println("Initializing Ground Control Station");
}

// Initialize LoRa module
void initializeLoRa() {
    Serial.println("Initializing LoRa Receiver");

    if (!lora.begin()) {
        Serial.println("LoRa Receiver: FAILED");
        return;
    }

    Serial.println("LoRa Receiver: OK");
}

// Receive incoming data
void receiveData() {
    while (lora.available()) {
        int incomingByte = lora.read();

        if (incomingByte < 0) {
            break;
        }

        char receivedChar = static_cast<char>(incomingByte);

        // End of packet
        if (receivedChar == '\n') {
            receiveBuffer.trim();

            if (receiveBuffer.length() > 0) {
                Serial.print("Received: ");
                Serial.println(receiveBuffer);
            }

            receiveBuffer = "";
        }
        else {
            // Accept printable ASCII characters only
            if (receivedChar >= 32 && receivedChar <= 126) {
                receiveBuffer += receivedChar;
            }
        }
    }
}