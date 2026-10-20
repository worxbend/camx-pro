#pragma once
#include "protocol.hpp"
#include <cstdarg>
#include <cstdio>

namespace camx {
class JsonWriter {
  public:
    JsonWriter(char *bytes, size_t capacity) : bytes_(bytes), capacity_(capacity) {}
    void append(const char *format, ...) {
        if (failed_)
            return;
        va_list args;
        va_start(args, format);
        int n = std::vsnprintf(bytes_ + used_, capacity_ - used_, format, args);
        va_end(args);
        if (n < 0 || static_cast<size_t>(n) >= capacity_ - used_) {
            failed_ = true;
            return;
        }
        used_ += static_cast<size_t>(n);
    }
    size_t size() const { return failed_ ? 0 : used_; }

  private:
    char *bytes_;
    size_t capacity_, used_ = 0;
    bool failed_ = false;
};
inline size_t writeStatus(const Device &device, Error result, bool storageOk, char *out,
                          size_t capacity) {
    JsonWriter json(out, capacity);
    const auto s = device.controller.state();
    const auto config = device.controller.config();
    auto b = [](bool value) { return value ? "true" : "false"; };
    json.append(
        "{\"firmware\":\"camx-pro-1.0.0\",\"api\":1,\"result\":\"%s\",\"epoch\":%lu,\"seq\":%lu,"
        "\"armed\":%s,\"referenced\":%s,\"stopped\":%s,\"moving\":%s,\"jogging\":%s,\"fault\":\"%"
        "s\",\"commissioned\":%s,\"storage_ok\":%s,\"settings_dirty\":%s,\"axes\":[",
        errorName(result), static_cast<unsigned long>(s.epoch),
        static_cast<unsigned long>(s.sequence), b(s.armed), b(s.referenced), b(s.stopped),
        b(s.moving), b(s.jogging), errorName(s.fault), b(config.commissioned), b(storageOk),
        b(device.dirty));
    for (unsigned i = 0; i < 2; ++i) {
        const auto &a = device.controller.axis(i);
        const auto &c = config.axis[i];
        json.append("%s{\"degrees\":%.6f,\"target\":%.6f,\"steps\":%ld,\"velocity\":%.6f,\"motor_"
                    "steps\":%.6f,\"reduction\":%.6f,\"minimum\":%.6f,\"maximum\":%.6f,\"speed\":%."
                    "6f,\"acceleration\":%.6f,\"inverted\":%s}",
                    i ? "," : "", a.steps / c.stepsPerDegree(), a.requested,
                    static_cast<long>(a.steps), a.velocity(), c.motorSteps, c.reduction, c.minimum,
                    c.maximum, c.speed, c.acceleration, b(c.inverted));
    }
    json.append("],\"max_tick_gap_us\":%llu,\"timing_faults\":%lu,\"presets\":[",
                static_cast<unsigned long long>(s.maxTickGapUs),
                static_cast<unsigned long>(s.timingFaults));
    for (size_t i = 0; i < device.presets.size(); ++i) {
        const auto &p = device.presets[i];
        json.append("%s{\"valid\":%s,\"pan\":%.6f,\"tilt\":%.6f}", i ? "," : "", b(p.valid), p.pan,
                    p.tilt);
    }
    json.append("]}");
    return json.size();
}
} // namespace camx
