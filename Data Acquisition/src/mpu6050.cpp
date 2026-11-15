#include "MPU6050.h"

// Constructor
MPU6050::MPU6050() : i2c(nullptr), initialized(false) {}

// Initialize sensor
bool MPU6050::begin(TwoWire *wire) {
    i2c = wire;

    if (i2c == nullptr) {
        initialized = false;
        return false;
    }

    initialized = mpu.begin(MPU_ADDR, i2c);

    if (!initialized) {
        return false;
    }

    // Sensor configuration
    setAccelerometerRange(MPU6050_RANGE_8_G);
    setGyroRange(MPU6050_RANGE_500_DEG);
    setFilterBandwidth(MPU6050_BAND_21_HZ);

    return true;
}

// Set accelerometer range
void MPU6050::setAccelerometerRange(mpu6050_accel_range_t range) {
    if (!initialized) return;

    mpu.setAccelerometerRange(range);
}

// Set gyroscope range
void MPU6050::setGyroRange(mpu6050_gyro_range_t range) {
    if (!initialized) return;

    mpu.setGyroRange(range);
}

// Set digital low-pass filter bandwidth
void MPU6050::setFilterBandwidth(mpu6050_bandwidth_t bandwidth) {
    if (!initialized) return;

    mpu.setFilterBandwidth(bandwidth);
}

// Read accelerometer, gyroscope, and temperature
bool MPU6050::getEvent(sensors_event_t *accel, sensors_event_t *gyro, sensors_event_t *temp) {
    if (!initialized || accel == nullptr || gyro == nullptr || temp == nullptr) {
        return false;
    }
    
    mpu.getEvent(accel, gyro, temp);
    
    return true;
}

// Check if the sensor is successfully initialized
bool MPU6050::isInitialized() const {
    return initialized;
}