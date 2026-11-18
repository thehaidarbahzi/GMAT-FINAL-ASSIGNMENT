
#ifndef BMP280_H
#define BMP280_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>

// BMP280 configuration
#define BMP280_ADDR 0x76

struct BMP280Data {
    float temperature; // in Celsius
    float pressure; // in Pascal
    float altitude; // in meters
};

class BMP280 {
public:
    // Constructor
    BMP280();

    // Sensor initialization
    bool begin(TwoWire *wire = &Wire);

    // Sensor configuration
    void setSampling(
        Adafruit_BMP280::sensor_mode mode,
        Adafruit_BMP280::sensor_sampling tempSampling,
        Adafruit_BMP280::sensor_sampling pressureSampling,
        Adafruit_BMP280::sensor_filter filter,
        Adafruit_BMP280::standby_duration duration
    );

    // Read sensor data
    void readData(BMP280Data *data);

    // Sensor status
    bool isInitialized() const;

private:
    // Adafruit BMP280 object
    Adafruit_BMP280 bmp;

    // I2C interface
    TwoWire *i2c;

    // Sensor status
    bool initialized;
};

#endif 
