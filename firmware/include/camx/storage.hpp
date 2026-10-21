#pragma once
#include "protocol.hpp"
#include <cstring>

namespace camx {
// Explicit wire layout, little endian, no struct padding. A changed mechanical contract
// discards old settings.
//
// Version 2 (392 bytes): "CXP" and version byte; 2 x (6 IEEE754 binary64: motor steps,
// minimum, maximum, speed, acceleration, jerk, then an inversion byte); commissioning
// byte; 8 x (pan and tilt binary64, valid byte, 16 name bytes padded with NUL); last pose
// (pan and tilt binary64, valid byte); mechanical fingerprint; CRC32.
//
// Version 1 (231 bytes) had no jerk, names or last pose. It is still accepted so that a
// firmware update keeps the operator's presets; missing values take their defaults.
inline constexpr size_t settingsBlobV1Size = 231;
using SettingsBlob = std::array<uint8_t, 392>;
inline uint32_t crc32(const uint8_t *bytes, size_t length) {
    uint32_t crc = 0xffffffff;
    for (size_t i = 0; i < length; ++i) {
        crc ^= bytes[i];
        for (unsigned b = 0; b < 8; ++b)
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}
inline SettingsBlob encodeSettings(const Device &device) {
    static_assert(sizeof(double) == 8, "settings require binary64");
    SettingsBlob blob{};
    blob[0] = 'C';
    blob[1] = 'X';
    blob[2] = 'P';
    blob[3] = 2;
    size_t at = 4;
    auto real = [&](double value) {
        uint64_t bits = 0;
        std::memcpy(&bits, &value, 8);
        for (unsigned i = 0; i < 8; ++i)
            blob[at++] = static_cast<uint8_t>(bits >> (8 * i));
    };
    for (auto a : device.controller.config().axis) {
        real(a.motorSteps);
        real(a.minimum);
        real(a.maximum);
        real(a.speed);
        real(a.acceleration);
        real(a.jerk);
        blob[at++] = a.inverted;
    }
    blob[at++] = device.controller.config().commissioned;
    for (const auto &p : device.presets) {
        real(p.pan);
        real(p.tilt);
        blob[at++] = p.valid;
        std::memcpy(blob.data() + at, p.name, presetNameCapacity);
        at += presetNameCapacity;
    }
    real(device.lastPose.pan);
    real(device.lastPose.tilt);
    blob[at++] = device.lastPose.valid;
    for (unsigned i = 0; i < 4; ++i)
        blob[at++] = static_cast<uint8_t>(mechanics::fingerprint >> (8 * i));
    const uint32_t crc = crc32(blob.data(), blob.size() - 4);
    for (unsigned i = 0; i < 4; ++i)
        blob[blob.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
    return blob;
}
// Transactional: on any failure the device is left exactly as it was.
inline bool decodeSettings(const uint8_t *bytes, size_t length, Device &device) {
    if (device.controller.state().armed || length < 8 || bytes[0] != 'C' || bytes[1] != 'X' ||
        bytes[2] != 'P')
        return false;
    const unsigned version = bytes[3];
    if (!((version == 1 && length == settingsBlobV1Size) ||
          (version == 2 && length == sizeof(SettingsBlob))))
        return false;
    uint32_t expected = 0;
    for (unsigned i = 0; i < 4; ++i)
        expected |= uint32_t(bytes[length - 4 + i]) << (8 * i);
    if (crc32(bytes, length - 4) != expected)
        return false;
    size_t at = 4;
    bool valid = true;
    auto real = [&]() {
        uint64_t bits = 0;
        for (unsigned i = 0; i < 8; ++i)
            bits |= uint64_t(bytes[at++]) << (8 * i);
        double value = 0;
        std::memcpy(&value, &bits, 8);
        return value;
    };
    auto boolean = [&]() {
        uint8_t value = bytes[at++];
        valid &= value <= 1;
        return value == 1;
    };
    Config config;
    for (auto &a : config.axis) {
        a.motorSteps = real();
        a.minimum = real();
        a.maximum = real();
        a.speed = real();
        a.acceleration = real();
        if (version >= 2)
            a.jerk = real();
        a.inverted = boolean();
    }
    config.commissioned = boolean();
    std::array<Preset, 8> presets{};
    for (auto &p : presets) {
        p.pan = real();
        p.tilt = real();
        p.valid = boolean();
        if (version >= 2) {
            // A canonical name: printable ASCII, then NUL padding up to the field's end.
            size_t used = 0;
            while (used < presetNameCapacity && bytes[at + used] != 0)
                ++used;
            valid &=
                validPresetName(std::string_view(reinterpret_cast<const char *>(bytes + at), used));
            for (size_t i = used; i < presetNameCapacity; ++i)
                valid &= bytes[at + i] == 0;
            std::memcpy(p.name, bytes + at, used);
            at += presetNameCapacity;
        }
        valid &= std::isfinite(p.pan) && std::isfinite(p.tilt);
        if (p.valid)
            valid &= p.pan >= config.axis[0].minimum && p.pan <= config.axis[0].maximum &&
                     p.tilt >= config.axis[1].minimum && p.tilt <= config.axis[1].maximum;
        else
            valid &= p.name[0] == 0;
    }
    Pose pose;
    if (version >= 2) {
        pose.pan = real();
        pose.tilt = real();
        pose.valid = boolean();
        valid &= std::isfinite(pose.pan) && std::isfinite(pose.tilt);
        if (pose.valid)
            valid &= pose.pan >= config.axis[0].minimum && pose.pan <= config.axis[0].maximum &&
                     pose.tilt >= config.axis[1].minimum && pose.tilt <= config.axis[1].maximum;
    }
    uint32_t fingerprint = 0;
    for (unsigned i = 0; i < 4; ++i)
        fingerprint |= uint32_t(bytes[at++]) << (8 * i);
    if (fingerprint != mechanics::fingerprint)
        return false;
    if (!valid || !validConfig(config))
        return false;
    if (device.controller.configure(config) != Error::Ok)
        return false;
    device.presets = presets;
    device.lastPose = pose;
    device.dirty = false;
    return true;
}
inline bool decodeSettings(const SettingsBlob &blob, Device &device) {
    return decodeSettings(blob.data(), blob.size(), device);
}
} // namespace camx
