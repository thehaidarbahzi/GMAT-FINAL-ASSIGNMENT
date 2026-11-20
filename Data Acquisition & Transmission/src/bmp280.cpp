#include "BMP280.h"


// Constructor
BMP280::BMP280() : i2c(nullptr), initialized(false) {}

// Initialize sensor
bool BMP280::begin(TwoWire *wire) {
    i2c = wire;
    
    if (i2c == nullptr) {
        initialized = false;
        return false;
    }
    
    initialized = bmp.begin(BMP280_ADDR);
    
    if (!initialized) {
        return false;
    }
    
    setSampling(
        Adafruit_BMP280::MODE_NORMAL,
        Adafruit_BMP280::SAMPLING_X2,
        Adafruit_BMP280::SAMPLING_X4,
        Adafruit_BMP280::FILTER_X2,
        Adafruit_BMP280::STANDBY_MS_1
    );
    
    return true;
}

// Read sensor data
void BMP280::readData(BMP280Data *data) {
    if (!initialized || data == nullptr) {
        return;
    }

    data->temperature = bmp.readTemperature();
    data->pressure = bmp.readPressure();
    data->altitude = bmp.readAltitude(1013.25);
}

// Configure sensor sampling
void BMP280::setSampling(
    Adafruit_BMP280::sensor_mode mode,
    Adafruit_BMP280::sensor_sampling tempSampling,
    Adafruit_BMP280::sensor_sampling pressureSampling,
    Adafruit_BMP280::sensor_filter filter,
    Adafruit_BMP280::standby_duration duration
) {
    if (!initialized) return;

    bmp.setSampling(
        mode,
        tempSampling,
        pressureSampling,
        filter,
        duration
    );
}

// Check initialization status
bool BMP280::isInitialized() const {
    return initialized;
}
