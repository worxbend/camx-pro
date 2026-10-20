#include "camx/storage.hpp"
#include <cstdlib>
#include <iostream>
#define CHECK(c)                                                                                   \
    do {                                                                                           \
        if (!(c)) {                                                                                \
            std::cerr << __LINE__ << ": " #c "\n";                                                 \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)
int main() {
    camx::Device a(7), b(9);
    a.presets[2] = {10, -10, true};
    const auto blob = camx::encodeSettings(a);
    CHECK(camx::decodeSettings(blob, b));
    CHECK(b.presets[2].valid && b.presets[2].pan == 10);
    CHECK(!b.controller.state().referenced && !b.controller.state().armed);
    for (size_t i = 0; i < blob.size(); ++i) {
        auto corrupt = blob;
        corrupt[i] ^= 1;
        CHECK(!camx::decodeSettings(corrupt, b));
    }
    auto reseal = [](auto &bytes) {
        const auto crc = camx::crc32(bytes.data(), bytes.size() - 4);
        for (unsigned i = 0; i < 4; ++i)
            bytes[bytes.size() - 4 + i] = static_cast<uint8_t>(crc >> (8 * i));
    };
    auto invalid = blob;
    invalid[44] = 2;
    reseal(invalid); // invalid inversion byte, with valid CRC
    CHECK(!camx::decodeSettings(invalid, b));
    invalid = blob;
    invalid[223] ^= 1;
    reseal(invalid); // different mechanical contract
    CHECK(!camx::decodeSettings(invalid, b));
    CHECK(b.presets[2].valid && b.presets[2].pan == 10); // failure is transactional
    std::cout << "settings round-trip and every-byte corruption: PASS\n";
}
