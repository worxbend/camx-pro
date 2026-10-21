#include "camx/storage.hpp"
#include <cstdlib>
#include <iostream>
#include <vector>
#define CHECK(c)                                                                                   \
    do {                                                                                           \
        if (!(c)) {                                                                                \
            std::cerr << __LINE__ << ": " #c "\n";                                                 \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)

namespace {
// The settings format written by firmware 1.0.0, reproduced byte for byte.
std::vector<uint8_t> encodeLegacy(const camx::Device &device) {
    std::vector<uint8_t> blob(camx::settingsBlobV1Size, 0);
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
        blob[at++] = static_cast<uint8_t>(camx::mechanics::fingerprint >> (8 * i));
    const uint32_t crc = camx::crc32(blob.data(), blob.size() - 4);
    for (unsigned i = 0; i < 4; ++i)
        blob[blob.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
    return blob;
}
template <typename Bytes> void reseal(Bytes &bytes) {
    const auto crc = camx::crc32(bytes.data(), bytes.size() - 4);
    for (unsigned i = 0; i < 4; ++i)
        bytes[bytes.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
}
template <typename Bytes> void put(Bytes &bytes, size_t at, double value) {
    uint64_t bits = 0;
    std::memcpy(&bits, &value, 8);
    for (unsigned i = 0; i < 8; ++i)
        bytes[at + i] = static_cast<uint8_t>(bits >> (8 * i));
}
bool same(const camx::Device &a, const camx::Device &b) {
    const auto ca = a.controller.config(), cb = b.controller.config();
    if (ca.commissioned != cb.commissioned)
        return false;
    for (unsigned i = 0; i < 2; ++i) {
        const auto &x = ca.axis[i], &y = cb.axis[i];
        if (x.motorSteps != y.motorSteps || x.minimum != y.minimum || x.maximum != y.maximum ||
            x.speed != y.speed || x.acceleration != y.acceleration || x.jerk != y.jerk ||
            x.inverted != y.inverted)
            return false;
    }
    for (size_t i = 0; i < a.presets.size(); ++i)
        if (a.presets[i].valid != b.presets[i].valid || a.presets[i].pan != b.presets[i].pan ||
            a.presets[i].tilt != b.presets[i].tilt ||
            std::strcmp(a.presets[i].name, b.presets[i].name) != 0)
            return false;
    return a.lastPose.valid == b.lastPose.valid && a.lastPose.pan == b.lastPose.pan &&
           a.lastPose.tilt == b.lastPose.tilt;
}
// Byte offsets in the version 2 layout: 4 header bytes, two 49-byte axes, the commissioning
// byte, eight 33-byte presets, the 17-byte pose, then fingerprint and CRC.
constexpr size_t axis0Jerk = 44, axis0Inverted = 52, axis1Inverted = 101, commissionedAt = 102,
                 poseAt = 367, fingerprintAt = 384;
constexpr size_t presetPan(size_t slot) {
    return 103 + 33 * slot;
}
constexpr size_t presetValid(size_t slot) {
    return presetPan(slot) + 16;
}
constexpr size_t presetName(size_t slot) {
    return presetPan(slot) + 17;
}
} // namespace

int main() {
    CHECK(sizeof(camx::SettingsBlob) == 392);
    camx::Device a(7), b(9);
    CHECK(a.execute(R"({"op":"settings","epoch":7,"seq":1,"commissioned":true,"pan_min":-60,)"
                    R"("pan_max":90,"pan_speed":2.5,"pan_accel":6,"pan_jerk":33.5,"tilt_jerk":120,)"
                    R"("tilt_inverted":true})",
                    0) == camx::Error::Ok);
    a.presets[2] = {10, -10, true};
    camx::setPresetName(a.presets[2], "Desk");
    a.presets[7] = {-60, 12, true};
    camx::setPresetName(a.presets[7], "ABCDEFGHIJKLMNOP");
    a.presets[4] = {0, 0, true};
    a.lastPose = {-12.25, 3.5, true};

    // Round trip.
    const auto blob = camx::encodeSettings(a);
    CHECK(camx::decodeSettings(blob, b));
    CHECK(same(a, b));
    CHECK(b.presets[2].valid && b.presets[2].pan == 10 && std::string(b.presets[2].name) == "Desk");
    CHECK(b.lastPose.valid && b.lastPose.pan == -12.25 && !b.dirty);
    CHECK(!b.controller.state().referenced && !b.controller.state().armed);
    CHECK(blob[axis0Inverted] == 0 && blob[axis1Inverted] == 1 && blob[commissionedAt] == 1);
    CHECK(blob[presetValid(0)] == 0 && blob[presetName(0)] == 0);
    CHECK(blob[presetValid(2)] == 1 && blob[presetName(2)] == 'D' && blob[poseAt + 16] == 1);

    // Every single-byte corruption is caught by the CRC and leaves the device untouched.
    camx::Device before(5);
    camx::Device target(5);
    CHECK(camx::decodeSettings(blob, target));
    for (size_t i = 0; i < blob.size(); ++i) {
        auto corrupt = blob;
        corrupt[i] ^= 1;
        CHECK(!camx::decodeSettings(corrupt, before));
        CHECK(!before.presets[2].valid && !before.lastPose.valid);
        CHECK(before.controller.config().axis[0].jerk == camx::defaultJerk);
    }
    CHECK(!camx::decodeSettings(blob.data(), blob.size() - 1, before));
    CHECK(!camx::decodeSettings(blob.data(), 0, before));
    CHECK(!camx::decodeSettings(blob.data(), 4, before));

    // Corrupt contents that carry a valid CRC are rejected too, and failure is transactional.
    auto rejected = [&](const char *what, auto mutate) {
        auto bad = blob;
        mutate(bad);
        reseal(bad);
        if (camx::decodeSettings(bad, target) || !same(target, b)) {
            std::cerr << "accepted: " << what << '\n';
            std::exit(1);
        }
    };
    rejected("axis 0 inversion byte", [&](auto &x) { x[axis0Inverted] = 2; });
    rejected("axis 1 inversion byte", [&](auto &x) { x[axis1Inverted] = 2; });
    rejected("commissioning byte", [&](auto &x) { x[commissionedAt] = 7; });
    rejected("preset valid byte", [&](auto &x) { x[presetValid(0)] = 2; });
    rejected("mechanical contract", [&](auto &x) { x[fingerprintAt] ^= 1; });
    rejected("version 3", [&](auto &x) { x[3] = 3; });
    rejected("version 1 with the new length", [&](auto &x) { x[3] = 1; });
    rejected("magic", [&](auto &x) { x[1] = 'Y'; });
    rejected("jerk NaN", [&](auto &x) { put(x, axis0Jerk, NAN); });
    rejected("jerk zero", [&](auto &x) { put(x, axis0Jerk, 0); });
    rejected("jerk above the ceiling", [&](auto &x) { put(x, axis0Jerk, 501); });
    rejected("name with a control character", [&](auto &x) { x[presetName(2) + 1] = 7; });
    rejected("name with a high byte", [&](auto &x) { x[presetName(2) + 1] = 0xC3; });
    rejected("name with data after the terminator", [&](auto &x) { x[presetName(2) + 6] = 'x'; });
    rejected("name on an empty slot", [&](auto &x) { x[presetName(0)] = 'x'; });
    rejected("preset outside the limits", [&](auto &x) { put(x, presetPan(2), 91); });
    rejected("pose valid byte", [&](auto &x) { x[poseAt + 16] = 2; });
    rejected("pose NaN", [&](auto &x) { put(x, poseAt, NAN); });
    rejected("pose outside the limits", [&](auto &x) { put(x, poseAt + 8, 91); });

    // The commissioning rule holds for stored jerk, changing nothing else in the blob.
    {
        camx::Device plain(30), loaded(31);
        auto stored = camx::encodeSettings(plain);
        put(stored, axis0Jerk, 40);
        reseal(stored);
        CHECK(camx::decodeSettings(stored, loaded) &&
              loaded.controller.config().axis[0].jerk == 40);
        put(stored, axis0Jerk, 200);
        reseal(stored);
        CHECK(!camx::decodeSettings(stored, loaded));
        stored[commissionedAt] = 1;
        reseal(stored);
        CHECK(camx::decodeSettings(stored, loaded) &&
              loaded.controller.config().axis[0].jerk == 200);
    }

    // Settings written by firmware 1.0.0 still load, with defaults for what they lack.
    camx::Device old(11), migrated(12);
    CHECK(old.execute(R"({"op":"settings","epoch":11,"seq":1,"pan_speed":2.5,"pan_accel":4,)"
                      R"("tilt_inverted":true,"pan_min":-12})",
                      0) == camx::Error::Ok);
    old.presets[0] = {5, -5, true};
    old.presets[6] = {-12, 15, true};
    const auto legacy = encodeLegacy(old);
    CHECK(legacy.size() == 231 && legacy[3] == 1);
    CHECK(camx::decodeSettings(legacy.data(), legacy.size(), migrated));
    const auto config = migrated.controller.config();
    CHECK(config.axis[0].speed == 2.5 && config.axis[0].acceleration == 4 &&
          config.axis[0].minimum == -12 && config.axis[1].inverted && !config.commissioned);
    CHECK(config.axis[0].jerk == camx::defaultJerk && config.axis[1].jerk == camx::defaultJerk);
    CHECK(migrated.presets[0].valid && migrated.presets[0].pan == 5 && migrated.presets[6].valid &&
          migrated.presets[6].pan == -12);
    for (const auto &preset : migrated.presets)
        CHECK(preset.name[0] == 0);
    CHECK(!migrated.lastPose.valid && !migrated.dirty);
    // It then re-encodes in the current format and comes back unchanged.
    camx::Device again(13);
    CHECK(camx::decodeSettings(camx::encodeSettings(migrated), again) && same(migrated, again));
    // A commissioned legacy blob with wide travel migrates as well.
    camx::Device wide(14), wideOut(15);
    CHECK(wide.execute(R"({"op":"settings","epoch":14,"seq":1,"commissioned":true,"pan_min":-150,)"
                       R"("pan_max":150,"tilt_max":80})",
                       0) == camx::Error::Ok);
    wide.presets[3] = {-150, 80, true};
    const auto wideLegacy = encodeLegacy(wide);
    CHECK(camx::decodeSettings(wideLegacy.data(), wideLegacy.size(), wideOut));
    CHECK(wideOut.presets[3].valid && wideOut.controller.config().commissioned);

    // Legacy blobs are held to the old standard: any flipped byte, wrong length or version.
    for (size_t i = 0; i < legacy.size(); ++i) {
        auto corrupt = legacy;
        corrupt[i] ^= 1;
        CHECK(!camx::decodeSettings(corrupt.data(), corrupt.size(), before));
    }
    auto badLegacy = legacy;
    badLegacy[44] = 2; // inversion byte of the first axis in the old layout
    reseal(badLegacy);
    CHECK(!camx::decodeSettings(badLegacy.data(), badLegacy.size(), before));
    badLegacy = legacy;
    badLegacy[223] ^= 1; // different mechanical contract
    reseal(badLegacy);
    CHECK(!camx::decodeSettings(badLegacy.data(), badLegacy.size(), before));
    badLegacy = legacy;
    badLegacy[3] = 2; // claims the new format at the old length
    reseal(badLegacy);
    CHECK(!camx::decodeSettings(badLegacy.data(), badLegacy.size(), before));
    CHECK(!camx::decodeSettings(legacy.data(), legacy.size() - 1, before));
    CHECK(!before.presets[0].valid);

    // A device that is armed never accepts stored settings.
    camx::Device armed(21);
    CHECK(armed.controller.reference(0, 0) == camx::Error::Ok);
    CHECK(armed.controller.arm(0) == camx::Error::Ok);
    CHECK(!camx::decodeSettings(blob, armed));
    std::cout << "settings v2 round-trip, v1 migration and every-byte corruption: PASS\n";
}
