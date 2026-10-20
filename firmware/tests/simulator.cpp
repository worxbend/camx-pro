// Host-only protocol fixture for browser tests. No ESP32 GPIO or live network.
#include "camx/status.hpp"
#include <chrono>
#include <iostream>
#include <string>
int main() {
    camx::Device device(12345);
    const auto start = std::chrono::steady_clock::now();
    uint64_t tick = 0;
    std::string line;
    while (std::getline(std::cin, line)) {
        auto now = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::microseconds>(
                                             std::chrono::steady_clock::now() - start)
                                             .count());
        while (tick + 250 <= now) {
            tick += 250;
            device.controller.tick(tick);
        }
        const auto result = device.execute(line, tick);
        if (device.dirty)
            device.dirty = false; // storage transport is separately tested
        char output[4096]{};
        if (!camx::writeStatus(device, result, true, output, sizeof(output)))
            return 2;
        std::cout << output << std::endl;
    }
}
