#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <Arduino.h>

// Packet format: <body>*<checksum>\n
// Body starts with the packet id, checksum is XOR of the body in 2 hex digits

// Calculate XOR checksum
inline uint8_t checksum(const String &data) {
    uint8_t result = 0;

    for (size_t i = 0; i < data.length(); i++) {
        result ^= static_cast<uint8_t>(data[i]);
    }

    return result;
}

// Build packet from body
inline String buildPacket(const String &body) {
    char text[3];
    snprintf(text, sizeof(text), "%02X", checksum(body));

    return body + "*" + text + "\n";
}

// Validate packet and extract body
inline bool parsePacket(String packet, String &body) {
    packet.trim();

    int star = packet.lastIndexOf('*');

    if (star <= 0 || static_cast<int>(packet.length()) - star - 1 != 2) {
        return false;
    }

    String received = packet.substring(star + 1);
    String data = packet.substring(0, star);

    if (strtol(received.c_str(), nullptr, 16) != checksum(data)) {
        return false;
    }

    body = data;

    return true;
}

#endif
