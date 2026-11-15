#ifndef MPU6050_H
#define MPU6050_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// MPU6050 configuration
#define MPU_ADDR 0x68

class MPU6050 {
public:
    // Constructor
    MPU6050();

    // Sensor initialization
    bool begin(TwoWire *wire = &Wire);

    // Sensor configuration
    void setAccelerometerRange(mpu6050_accel_range_t range);
    void setGyroRange(mpu6050_gyro_range_t range);
    void setFilterBandwidth(mpu6050_bandwidth_t bandwidth);

    // Read sensor data
    bool getEvent(
        sensors_event_t *accel,
        sensors_event_t *gyro,
        sensors_event_t *temp
    );

    // Sensor status
    bool isInitialized() const;

private:
    // Adafruit MPU6050 object
    Adafruit_MPU6050 mpu;

    // I2C interface
    TwoWire *i2c;

    // Sensor status
    bool initialized;
    
};

#endif 