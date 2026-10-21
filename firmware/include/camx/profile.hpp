#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>

namespace camx {
// Kinematic ceilings in step units: steps/s, steps/s^2 and steps/s^3.
struct Limits {
    double velocity = 0, acceleration = 0, jerk = 0;
    bool usable() const {
        return std::isfinite(velocity) && std::isfinite(acceleration) && std::isfinite(jerk) &&
               velocity > 0 && acceleration > 0 && jerk > 0;
    }
    // Stretching a profile in time by k >= 1 keeps its shape when the ceilings become
    // v/k, a/k^2 and j/k^3: every phase then lasts exactly k times longer.
    Limits stretched(double k) const {
        return {velocity / k, acceleration / (k * k), jerk / (k * k * k)};
    }
};

// One-dimensional jerk-limited motion along a single direction, stored as at most seven
// constant-jerk segments and evaluated analytically at any time. Nothing is queued or
// replayed: a late caller simply evaluates a later time (or rebases its clock).
class Profile {
  public:
    double duration() const { return duration_; }
    double distance() const { return distance_; }
    void clear() {
        count_ = 0;
        duration_ = distance_ = time_ = x_ = v_ = a_ = 0;
    }

    // Rest to rest over `distance` (> 0) with the classic seven-phase S-curve.
    bool planRestToRest(double distance, const Limits &limits) {
        clear();
        if (!limits.usable() || !std::isfinite(distance) || distance < 0)
            return false;
        if (distance == 0)
            return true;
        const double V = limits.velocity, A = limits.acceleration, J = limits.jerk;
        double ramp, hold, cruise = 0; // jerk phase, constant-acceleration phase, cruise
        if (V * J >= A * A) {
            ramp = A / J;
            hold = V / A - ramp;
        } else {
            ramp = std::sqrt(V / J);
            hold = 0;
        }
        const double span = V * (2 * ramp + hold); // distance of the accelerate + brake phases
        if (distance >= span) {
            cruise = (distance - span) / V;
        } else if (distance >= 2 * A * A * A / (J * J)) {
            // Peak speed is below V but the acceleration ceiling is still reached.
            ramp = A / J;
            hold = (-3 * ramp + std::sqrt(ramp * ramp + 4 * distance / A)) / 2;
        } else {
            ramp = std::cbrt(distance / (2 * J)); // acceleration never reaches A
            hold = 0;
        }
        append(ramp, J);
        append(hold, 0);
        append(ramp, -J);
        append(cruise, 0);
        append(ramp, -J);
        append(hold, 0);
        append(ramp, J);
        distance_ = distance;
        duration_ = time_;
        return true;
    }

    // Quickest jerk-limited stop from speed `velocity` (>= 0) and signed acceleration along
    // the direction of travel. The result starts at x = 0 and ends at rest at `distance()`.
    bool planStop(double velocity, double acceleration, const Limits &limits) {
        clear();
        if (!limits.usable() || !std::isfinite(velocity) || !std::isfinite(acceleration))
            return false;
        velocity = std::max(velocity, 0.0);
        if (velocity == 0 && acceleration == 0)
            return true;
        const double J = limits.jerk;
        const double A = std::max(limits.acceleration, std::abs(acceleration));
        v_ = velocity;
        a_ = acceleration;
        // Ramp the acceleration down to -peak, optionally hold it, then ramp back to zero.
        double peak = std::sqrt(acceleration * acceleration / 2 + J * velocity);
        if (acceleration < 0)
            peak = std::max(peak, -acceleration);
        double hold = 0;
        if (peak > A) {
            peak = A;
            hold =
                std::max(0.0, (velocity + (acceleration * acceleration - 2 * A * A) / (2 * J)) / A);
        }
        append((acceleration + peak) / J, -J);
        append(hold, 0);
        append(peak / J, J);
        distance_ = std::max(x_, 0.0);
        duration_ = time_;
        return true;
    }

    // Position, speed and acceleration at time t (clamped to the profile).
    void evaluate(double t, double &x, double &v, double &a) const {
        if (count_ == 0 || t >= duration_) {
            x = distance_;
            v = a = 0;
            return;
        }
        t = std::max(t, 0.0);
        size_t i = count_ - 1;
        while (i > 0 && t < segments_[i].t)
            --i;
        const Segment &s = segments_[i];
        const double tau = t - s.t;
        x = std::clamp(s.x + tau * (s.v + tau * (s.a / 2 + tau * s.j / 6)), 0.0, distance_);
        v = std::max(s.v + tau * (s.a + tau * s.j / 2), 0.0);
        a = s.a + tau * s.j;
    }

    // Time at which the profile reaches position `target`. `hint` is a nearby time that seeds
    // the search. Safeguarded Newton steps: two or three when the hint is close, as it is
    // for a step that is only a timer tick late. If the search runs out of rounds, the
    // result is still on the far side of the crossing, never before it.
    double timeAt(double target, double hint) const {
        if (count_ == 0 || target <= 0)
            return 0;
        if (target >= distance_)
            return duration_;
        size_t i = count_ - 1;
        while (i > 0 && target < segments_[i].x)
            --i;
        const Segment &s = segments_[i];
        const double length = (i + 1 < count_ ? segments_[i + 1].t : duration_) - s.t;
        double lo = 0, hi = length, tau = std::clamp(hint - s.t, lo, hi);
        for (int round = 0; round < 24; ++round) {
            const double f = s.x + tau * (s.v + tau * (s.a / 2 + tau * s.j / 6)) - target;
            if (f > 0)
                hi = tau;
            else
                lo = tau;
            if (std::abs(f) < 1e-9)
                return s.t + tau;
            const double v = s.v + tau * (s.a + tau * s.j / 2);
            double next = v > 1e-9 ? tau - f / v : (lo + hi) / 2;
            if (!(next > lo && next < hi))
                next = (lo + hi) / 2;
            tau = next;
        }
        return s.t + hi;
    }

  private:
    struct Segment {
        double t, x, v, a, j; // start time and state, and the constant jerk
    };
    std::array<Segment, 8> segments_{};
    size_t count_ = 0;
    double duration_ = 0, distance_ = 0;
    double time_ = 0, x_ = 0, v_ = 0, a_ = 0; // state at the end of the segments so far

    void append(double tau, double jerk) {
        if (!(tau > 0) || count_ == segments_.size())
            return;
        segments_[count_++] = {time_, x_, v_, a_, jerk};
        x_ += tau * (v_ + tau * (a_ / 2 + tau * jerk / 6));
        v_ += tau * (a_ + tau * jerk / 2);
        a_ += tau * jerk;
        time_ += tau;
    }
};
} // namespace camx
