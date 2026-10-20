#pragma once
#include "mechanics.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace camx {
// Bits correspond directly to ULN2003 IN1, IN2, IN3, IN4. No PWM/STEP-DIR.
inline constexpr uint8_t halfSteps[] = {1, 3, 2, 6, 4, 12, 8, 9};

struct AxisConfig {
    double motorSteps = 4096; // geared motor output, internal reduction already included
    double reduction = 4;
    double minimum = -20, maximum = 20;
    double speed = 4, acceleration = 8;
    bool inverted = false;
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

// Rest-to-rest trapezoids, evaluated analytically using a monotonic 64-bit clock.
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
        velocity_ = 0;
    }
    void begin(double degrees, uint64_t now, double speedScale = 1) {
        requested = degrees;
        beginSteps(config.quantize(degrees), now, speedScale);
    }
    void cancel() {
        moving = false;
        velocity_ = 0;
        position_ = steps;
        requested = steps / config.stepsPerDegree();
    }
    void brake(uint64_t now) {
        if (!moving || braking_)
            return;
        start_ = position_;
        direction_ = velocity_ < 0 ? -1 : 1;
        peak_ = std::abs(velocity_);
        acceleration_ = config.acceleration * config.stepsPerDegree();
        ramp_ = peak_ / acceleration_;
        duration_ = ramp_;
        distance_ = peak_ * ramp_ / 2;
        target_ = std::clamp(static_cast<int32_t>(std::lround(start_ + direction_ * distance_)),
                             config.lowStep(), config.highStep());
        requested = target_ / config.stepsPerDegree();
        began_ = now;
        braking_ = true;
    }
    // False indicates a missed scheduling deadline, not a successful catch-up.
    bool tick(uint64_t now) {
        if (!moving)
            return true;
        double t = static_cast<double>(now - began_) / 1000000.0;
        sample(t);
        const int32_t desired = std::clamp(static_cast<int32_t>(std::lround(position_)),
                                           config.lowStep(), config.highStep());
        const int32_t delta = desired - steps;
        if (std::abs(delta) > 1)
            return false;
        if (delta != 0) {
            if (lastStep_ != 0 && now - lastStep_ < static_cast<uint64_t>(std::ceil(
                                                        1000000.0 / mechanics::maxStepRate)))
                return true;
            // Rebase at the exact next half-step threshold. Timer quantization may
            // lengthen a profile, but never accumulates debt for a later burst.
            const double crossing =
                std::clamp(direction_ * (steps + direction_ * 0.5 - start_), 0.0, distance_);
            double due = 0;
            if (braking_)
                due = duration_ -
                      std::sqrt(std::max(0.0, 2 * (distance_ - crossing) / acceleration_));
            else if (crossing < peak_ * ramp_ / 2)
                due = std::sqrt(2 * crossing / acceleration_);
            else if (crossing > distance_ - peak_ * ramp_ / 2)
                due = duration_ - std::sqrt(2 * (distance_ - crossing) / acceleration_);
            else
                due = crossing / peak_ + ramp_ / 2;
            const uint64_t dueAt = began_ + static_cast<uint64_t>(std::ceil(due * 1000000.0));
            if (now < dueAt)
                return true;
            began_ += now - dueAt;
            t = static_cast<double>(now - began_) / 1000000.0;
            sample(t);
            const int direction = (delta > 0 ? 1 : -1) * (config.inverted ? -1 : 1);
            phase = static_cast<uint8_t>((phase + direction + 8) % 8);
            steps += delta;
            lastStep_ = now;
        }
        if (t >= duration_ && steps == target_)
            moving = false;
        return true;
    }
    double velocity() const { return velocity_ / config.stepsPerDegree(); }

  private:
    double start_ = 0, position_ = 0, velocity_ = 0, direction_ = 1;
    double peak_ = 0, acceleration_ = 0, ramp_ = 0, duration_ = 0, distance_ = 0;
    int32_t target_ = 0;
    uint64_t began_ = 0, lastStep_ = 0;
    bool braking_ = false;

    void sample(double t) {
        double traveled = 0, speed = 0;
        if (t >= duration_) {
            position_ = target_;
        } else if (braking_) {
            traveled = peak_ * t - acceleration_ * t * t / 2;
            speed = peak_ - acceleration_ * t;
            position_ = start_ + direction_ * traveled;
        } else {
            if (t < ramp_) {
                traveled = acceleration_ * t * t / 2;
                speed = acceleration_ * t;
            } else if (t < duration_ - ramp_) {
                traveled = peak_ * (t - ramp_ / 2);
                speed = peak_;
            } else {
                const double remaining = duration_ - t;
                traveled = distance_ - acceleration_ * remaining * remaining / 2;
                speed = acceleration_ * remaining;
            }
            position_ = start_ + direction_ * traveled;
        }
        velocity_ = direction_ * speed;
    }

    void beginSteps(int32_t target, uint64_t now, double scale) {
        target_ = target;
        start_ = steps;
        position_ = start_;
        distance_ = std::abs(target_ - start_);
        direction_ = target_ < start_ ? -1 : 1;
        acceleration_ = config.acceleration * config.stepsPerDegree();
        const double maxSpeed = config.speed * config.stepsPerDegree() * scale;
        ramp_ = std::min(maxSpeed / acceleration_, std::sqrt(distance_ / acceleration_));
        peak_ = acceleration_ * ramp_;
        duration_ = peak_ > 0 ? distance_ / peak_ + ramp_ : 0;
        velocity_ = 0;
        began_ = now;
        braking_ = false;
        moving = target_ != steps;
    }
};
} // namespace camx
