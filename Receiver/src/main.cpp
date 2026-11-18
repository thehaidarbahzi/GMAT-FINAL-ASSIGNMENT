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
static uint8_t receiveBuffer[300];
static size_t receivedByteCount = 0;
static unsigned long lastByteMillis = 0;

// Packet statistics
static unsigned long receivedCount = 0;
static unsigned long lostCount = 0;
static unsigned long badCount = 0;
static unsigned long lastId = 0;
static bool hasLastId = false;

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

    E22Config config;
    config.channel = LORA_CHANNEL;
    config.airRate = LORA_AIR_RATE;
    config.txPower = LORA_TX_POWER;

    if (lora.begin(9600, config)) {
        Serial.println("LoRa Receiver: OK");
    } else {
        Serial.print("LoRa Receiver: FAILED (");
        Serial.print(lora.lastError());
        Serial.println(")");
    }
}

// Receive incoming data
void receiveData() {
    while (lora.available()) {
        int incomingByte = lora.read();

        if (incomingByte < 0) {
            break;
        }

        if (receivedByteCount < sizeof(receiveBuffer)) {
            receiveBuffer[receivedByteCount++] = static_cast<uint8_t>(incomingByte);
        }

        lastByteMillis = millis();
    }

    // End of packet (no data for PACKET_GAP)
    if (receivedByteCount > 0 && millis() - lastByteMillis > PACKET_GAP) {
        processPacket(receiveBuffer, receivedByteCount);
        receivedByteCount = 0;
    }
}

// Validate and print received packet
void processPacket(const uint8_t *data, size_t length) {
    uint8_t rssiRaw = 0;

    // Last byte is the RSSI of the packet
    if (lora.rssiEnabled()) {
        if (length < 2) {
            badCount++;
            Serial.println("Received: Invalid packet");
            return;
        }

        rssiRaw = data[length - 1];
        length--;
    }

    String packet = "";

    for (size_t i = 0; i < length; i++) {
        packet += static_cast<char>(data[i]);
    }

    String body;

    if (!parsePacket(packet, body)) {
        badCount++;
        return;
    }

    // Packet id is the first field
    unsigned long id = strtoul(body.c_str(), nullptr, 10);

    if (hasLastId && id > lastId + 1) {
        lostCount += id - lastId - 1;
    }

    lastId = id;
    hasLastId = true;
    receivedCount++;

    Serial.print(body);
    Serial.print(",");
    Serial.print(receivedCount);
    Serial.print(",");
    Serial.print(badCount);
    Serial.print(",");
    Serial.print(lostCount);
    Serial.print(",");
    Serial.print(receivedCount + lostCount);

    int rssi;

    if (E22::rssiToDbm(rssiRaw, rssi)) {
        Serial.print(",");
        Serial.print(rssi);
    }
    Serial.println();
}
