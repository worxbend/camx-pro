#pragma once
#include "mechanics.hpp"
#include "profile.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace camx {
// Bits correspond directly to ULN2003 IN1, IN2, IN3, IN4. No PWM/STEP-DIR.
inline constexpr uint8_t halfSteps[] = {1, 3, 2, 6, 4, 12, 8, 9};

// Default jerk is ten times the acceleration: the acceleration ramps in 0.1 s.
inline constexpr double jerkPerAcceleration = 10;

struct AxisConfig {
    double motorSteps = 4096; // geared motor output, internal reduction already included
    double reduction = 4;
    double minimum = -20, maximum = 20;
    double speed = 4, acceleration = 8;
    bool inverted = false;
    double jerk = jerkPerAcceleration * mechanics::acceleration; // degrees/s^3
    double stepsPerDegree() const { return motorSteps * reduction / 360.0; }
    int32_t lowStep() const { return static_cast<int32_t>(std::ceil(minimum * stepsPerDegree())); }
    int32_t highStep() const {
        return static_cast<int32_t>(std::floor(maximum * stepsPerDegree()));
    }
    int32_t quantize(double degrees) const {
        return std::clamp(static_cast<int32_t>(std::lround(degrees * stepsPerDegree())), lowStep(),
                          highStep());
    }
};

// Runtime multipliers that only ever lower the configured ceilings.
struct Scales {
    double speed = 1, accel = 1, jerk = 1;
};
inline constexpr double minScale = 0.05;
inline bool validScale(double value) {
    return std::isfinite(value) && value >= minScale && value <= 1;
}

// Jerk-limited S-curves, evaluated analytically against a monotonic 64-bit clock.
// There is no queue of old steps to replay after a scheduling stall.
class Axis {
  public:
    AxisConfig config;
    int32_t steps = 0;
    double requested = 0;
    uint8_t phase = 0;
    bool moving = false;

    void reference(double degrees) {
        steps = config.quantize(degrees);
        requested = degrees;
        moving = false;
        position_ = steps;
        velocity_ = acceleration_ = 0;
        profile_.clear();
    }
    // Plans a rest-to-rest move on an idle axis and returns its duration in seconds, or a
    // negative number when the move cannot be planned. `stretch` >= 1 makes the same move
    // take `stretch` times longer without exceeding any ceiling. commit() starts it.
    double prepare(double degrees, const Scales &scales, double stretch = 1) {
        if (moving || !(stretch >= 1) || !std::isfinite(stretch))
            return -1;
        target_ = config.quantize(degrees);
        direction_ = target_ < steps ? -1 : 1;
        limits_ = ceilings(scales).stretched(stretch);
        if (!profile_.planRestToRest(std::abs(static_cast<double>(target_ - steps)), limits_))
            return -1;
        return profile_.duration();
    }
    void commit(double degrees, uint64_t now) {
        requested = degrees;
        start_ = position_ = steps;
        velocity_ = acceleration_ = 0;
        began_ = now;
        elapsed_ = 0;
        braking_ = false;
        moving = target_ != steps;
    }
    void cancel() {
        moving = false;
        velocity_ = acceleration_ = 0;
        position_ = steps;
        requested = steps / config.stepsPerDegree();
        profile_.clear();
    }
    // Smooth stop from the exact present speed and acceleration, using the same ceilings
    // as the move in progress, so it never needs more room than that move had left.
    void brake(uint64_t now) {
        if (!moving || braking_)
            return;
        sample(elapsed(now));
        const double from = position_;
        if (!profile_.planStop(std::abs(velocity_), direction_ * acceleration_, limits_)) {
            cancel();
            return;
        }
        start_ = from;
        began_ = now;
        elapsed_ = 0;
        braking_ = true;
        target_ =
            std::clamp(static_cast<int32_t>(std::lround(start_ + direction_ * profile_.distance())),
                       config.lowStep(), config.highStep());
        requested = target_ / config.stepsPerDegree();
    }
    // False indicates a missed scheduling deadline, not a successful catch-up.
    bool tick(uint64_t now) {
        if (!moving)
            return true;
        double t = elapsed(now);
        sample(t);
        elapsed_ = t;
        const int32_t desired = std::clamp(static_cast<int32_t>(std::lround(position_)),
                                           config.lowStep(), config.highStep());
        const int32_t delta = desired - steps;
        if (std::abs(delta) > 1)
            return false;
        if (delta != 0) {
            if (delta * direction_ < 0)
                return false; // the profile only ever advances in one direction
            if (lastStep_ != 0 && now - lastStep_ < static_cast<uint64_t>(std::ceil(
                                                        1000000.0 / mechanics::maxStepRate)))
                return true;
            // Rebase at the exact next half-step threshold. Timer quantization may
            // lengthen a profile, but never accumulates debt for a later burst. One extra
            // microsecond keeps the rebased position on the far side of the threshold, so
            // numerical error can never ask for a step backwards.
            const double crossing =
                std::clamp(direction_ * (steps + delta * 0.5 - start_), 0.0, profile_.distance());
            const double due = profile_.timeAt(crossing, t);
            const uint64_t dueAt = began_ + static_cast<uint64_t>(std::ceil(due * 1000000.0)) + 1;
            if (now < dueAt)
                return true;
            began_ += now - dueAt;
            t = elapsed(now);
            sample(t);
            elapsed_ = t;
            const int direction = (delta > 0 ? 1 : -1) * (config.inverted ? -1 : 1);
            phase = static_cast<uint8_t>((phase + direction + 8) % 8);
            steps += delta;
            lastStep_ = now;
        }
        if (t >= profile_.duration() && steps == target_)
            moving = false;
        return true;
    }
    double velocity() const { return velocity_ / config.stepsPerDegree(); }
    double acceleration() const { return acceleration_ / config.stepsPerDegree(); }
    // Seconds of planned motion left as of the latest tick.
    double remaining() const { return moving ? std::max(0.0, profile_.duration() - elapsed_) : 0; }
    // Step the axis is heading for, or holding when idle or braking to a stop.
    int32_t destination() const { return moving ? target_ : steps; }
    bool braking() const { return moving && braking_; }

  private:
    Profile profile_;
    Limits limits_;
    double start_ = 0, position_ = 0, velocity_ = 0, acceleration_ = 0, elapsed_ = 0;
    int direction_ = 1;
    int32_t target_ = 0;
    uint64_t began_ = 0, lastStep_ = 0;
    bool braking_ = false;

    Limits ceilings(const Scales &scales) const {
        const double perDegree = config.stepsPerDegree();
        return {config.speed * scales.speed * perDegree,
                config.acceleration * scales.accel * perDegree,
                config.jerk * scales.jerk * perDegree};
    }
    double elapsed(uint64_t now) const {
        return now > began_ ? static_cast<double>(now - began_) / 1000000.0 : 0;
    }
    void sample(double t) {
        double x, v, a;
        profile_.evaluate(t, x, v, a);
        position_ = start_ + direction_ * x;
        velocity_ = direction_ * v;
        acceleration_ = direction_ * a;
    }
};
} // namespace camx
