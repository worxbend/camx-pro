#pragma once
#include "protocol.hpp"
#include <cstring>

namespace camx {
// Explicit wire layout: magic/version, 2x(5 IEEE754 binary64 + inversion byte),
// commissioning byte, 8x(pan/tilt binary64 + valid byte), mechanical fingerprint,
// CRC32. No struct padding. A changed mechanical contract discards old settings.
using SettingsBlob = std::array<uint8_t, 231>;
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
    blob[3] = 1;
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
        blob[at++] = a.inverted;
    }
    blob[at++] = device.controller.config().commissioned;
    for (auto p : device.presets) {
        real(p.pan);
        real(p.tilt);
        blob[at++] = p.valid;
    }
    for (unsigned i = 0; i < 4; ++i)
        blob[at++] = static_cast<uint8_t>(mechanics::fingerprint >> (8 * i));
    const uint32_t crc = crc32(blob.data(), blob.size() - 4);
    for (unsigned i = 0; i < 4; ++i)
        blob[blob.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
    return blob;
}
inline bool decodeSettings(const SettingsBlob &blob, Device &device) {
    if (device.controller.state().armed || blob[0] != 'C' || blob[1] != 'X' || blob[2] != 'P' ||
        blob[3] != 1)
        return false;
    uint32_t expected = 0;
    for (unsigned i = 0; i < 4; ++i)
        expected |= uint32_t(blob[blob.size() - 4 + i]) << (8 * i);
    if (crc32(blob.data(), blob.size() - 4) != expected)
        return false;
    size_t at = 4;
    bool valid = true;
    auto real = [&]() {
        uint64_t bits = 0;
        for (unsigned i = 0; i < 8; ++i)
            bits |= uint64_t(blob[at++]) << (8 * i);
        double value = 0;
        std::memcpy(&value, &bits, 8);
        return value;
    };
    auto boolean = [&]() {
        uint8_t value = blob[at++];
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
        a.inverted = boolean();
    }
    config.commissioned = boolean();
    std::array<Preset, 8> presets{};
    for (auto &p : presets) {
        p.pan = real();
        p.tilt = real();
        p.valid = boolean();
        valid &= std::isfinite(p.pan) && std::isfinite(p.tilt);
        if (p.valid)
            valid &= p.pan >= config.axis[0].minimum && p.pan <= config.axis[0].maximum &&
                     p.tilt >= config.axis[1].minimum && p.tilt <= config.axis[1].maximum;
    }
    uint32_t fingerprint = 0;
    for (unsigned i = 0; i < 4; ++i)
        fingerprint |= uint32_t(blob[at++]) << (8 * i);
    if (fingerprint != mechanics::fingerprint)
        return false;
    if (!valid || !validConfig(config))
        return false;
    if (device.controller.configure(config) != Error::Ok)
        return false;
    device.presets = presets;
    device.dirty = false;
    return true;
}
} // namespace camx
