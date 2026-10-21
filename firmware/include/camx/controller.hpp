#pragma once
#include "config.hpp"
#include <array>

namespace camx {
enum class Error {
    Ok,
    NotArmed,
    NotReferenced,
    Busy,
    Range,
    Stopped,
    Timing,
    Invalid,
    Stale,
    Storage
};
inline const char *errorName(Error error) {
    constexpr const char *names[] = {"ok",    "not_armed", "not_referenced", "busy",
                                     "range", "stopped",   "timing_fault",   "invalid",
                                     "stale", "storage"};
    return names[static_cast<unsigned>(error)];
}
struct State {
    bool armed = false, referenced = false, stopped = false, moving = false, jogging = false;
    bool queued = false; // a retargeted move waits for the axes to finish braking
    std::array<int32_t, 2> steps{};
    uint32_t epoch = 1, sequence = 0;
    Error fault = Error::Ok;
    uint64_t maxTickGapUs = 0, maxTickCostUs = 0;
    uint32_t timingFaults = 0;
    double eta = 0; // seconds of planned motion left as of the latest tick
    Scales scales{};
};

class Controller {
  public:
    explicit Controller(uint32_t epoch) {
        state_.epoch = epoch ? epoch : 1;
        for (unsigned i = 0; i < 2; ++i)
            axes_[i].config = config_.axis[i];
    }
    State state() const {
        State s = state_;
        s.scales = scales_;
        s.queued = queued_.active;
        s.moving = queued_.active;
        for (unsigned i = 0; i < 2; ++i) {
            s.steps[i] = axes_[i].steps;
            s.moving |= axes_[i].moving;
            s.eta = std::max(s.eta, axes_[i].remaining());
        }
        if (queued_.active)
            s.eta += queuedDuration_;
        return s;
    }
    // Commanded destination of an axis in degrees: the queued target while one waits.
    double target(unsigned i) const {
        if (!queued_.active)
            return axes_[i].requested;
        return i == 0 ? queued_.pan : queued_.tilt;
    }
    const Axis &axis(unsigned i) const { return axes_[i]; }
    // Estimated angle of an axis, always inside its configured travel.
    double position(unsigned i) const {
        const auto &a = axes_[i];
        return std::clamp(a.steps / a.config.stepsPerDegree(), a.config.minimum, a.config.maximum);
    }
    Scales scales() const { return scales_; }
    Config config() const { return config_; }
    Error configure(const Config &c) {
        if (state_.armed)
            return Error::Busy;
        if (!validConfig(c))
            return Error::Invalid;
        config_ = c;
        for (unsigned i = 0; i < 2; ++i) {
            axes_[i].config = c.axis[i];
            axes_[i].reference(0);
        }
        state_.referenced = false;
        queued_.active = false;
        invalidate();
        return Error::Ok;
    }
    // Runtime speed, acceleration and jerk multipliers. They only lower the configured
    // ceilings, apply to motion planned afterwards and are never stored.
    Error setScales(const Scales &s) {
        if (!validScale(s.speed) || !validScale(s.accel) || !validScale(s.jerk))
            return Error::Range;
        scales_ = s;
        return Error::Ok;
    }
    // Whether authorize() would accept this epoch and sequence, without consuming it.
    bool wouldAuthorize(uint32_t epoch, uint32_t sequence) const {
        return epoch == state_.epoch && sequence != 0 && sequence > state_.sequence;
    }
    Error authorize(uint32_t epoch, uint32_t sequence, uint64_t now) {
        if (epoch != state_.epoch || sequence == 0 || sequence <= state_.sequence)
            return Error::Stale;
        state_.sequence = sequence;
        heartbeat_ = now;
        return Error::Ok;
    }
    uint8_t coils(unsigned i) const { return state_.armed ? halfSteps[axes_[i].phase] : 0; }
    Error reference(double pan, double tilt) {
        if (state_.armed)
            return Error::Busy;
        if (!inRange(0, pan) || !inRange(1, tilt))
            return Error::Range;
        axes_[0].reference(pan);
        axes_[1].reference(tilt);
        state_.referenced = true;
        state_.stopped = false;
        state_.fault = Error::Ok;
        invalidate();
        return Error::Ok;
    }
    Error arm(uint64_t now) {
        if (state_.stopped)
            return Error::Stopped;
        if (state_.armed)
            return Error::Busy;
        if (!state_.referenced)
            return Error::NotReferenced;
        state_.armed = true;
        lastTick_ = now;
        heartbeat_ = now;
        return Error::Ok;
    }
    void disarm() {
        for (auto &a : axes_)
            a.cancel();
        state_.armed = false;
        state_.referenced = false;
        state_.jogging = false;
        queued_.active = false;
        invalidate();
    }
    // Both axes start together and arrive together: the one with less to do is stretched in
    // time to match the slower one. Different profile shapes can still curve the pan/tilt path.
    // `speed` scales the top speed for this move only. A move requested while another is
    // in progress is refused with Busy unless `retarget` is set; then both axes brake
    // smoothly and the newest target starts from wherever they come to rest.
    Error move(double pan, double tilt, bool relative, uint64_t now, double speed = 1,
               bool retarget = false) {
        if (state_.stopped)
            return Error::Stopped;
        if (!state_.armed)
            return Error::NotArmed;
        if (state_.jogging)
            return Error::Busy;
        const bool underway = axes_[0].moving || axes_[1].moving || queued_.active;
        if (underway && !retarget)
            return Error::Busy;
        if (!validScale(speed))
            return Error::Range;
        if (relative) {
            pan += queued_.active ? queued_.pan : axes_[0].requested;
            tilt += queued_.active ? queued_.tilt : axes_[1].requested;
        }
        if (!inRange(0, pan) || !inRange(1, tilt))
            return Error::Range;
        if (!underway) {
            const Error started = startMove(pan, tilt, speed, now);
            if (started != Error::Ok)
                return started;
        } else if (queued_.active || axes_[0].braking() || axes_[1].braking() ||
                   axes_[0].destination() != axes_[0].config.quantize(pan) ||
                   axes_[1].destination() != axes_[1].config.quantize(tilt)) {
            queued_ = {pan, tilt, speed, true};
            for (auto &a : axes_)
                a.brake(now);
            // Expected length of the queued move from where the axes will come to rest.
            Scales scales = scales_;
            scales.speed *= speed;
            queuedDuration_ = std::max(axes_[0].estimate(axes_[0].destination(), pan, scales),
                                       axes_[1].estimate(axes_[1].destination(), tilt, scales));
        } // else: already heading exactly there; a repeated target must not restart the ramp
        heartbeat_ = now;
        return Error::Ok;
    }
    Error jog(double pan, double tilt, uint64_t now) {
        if (state_.stopped)
            return Error::Stopped;
        if (!state_.armed)
            return Error::NotArmed;
        if (!std::isfinite(pan) || !std::isfinite(tilt) || std::abs(pan) > 1 || std::abs(tilt) > 1)
            return Error::Range;
        if ((pan != 0 && std::abs(pan) < 0.025) || (tilt != 0 && std::abs(tilt) < 0.025))
            return Error::Range;
        if (pan == 0 && tilt == 0) {
            queued_.active = false;
            for (auto &a : axes_)
                a.brake(now);
            state_.jogging = false;
        } else if (state_.jogging && jogPan_ == pan && jogTilt_ == tilt) {
            // Lease renewal only: do not restart a profile or append a move.
        } else {
            if (state().moving || state_.jogging)
                return Error::Busy;
            const double values[] = {pan, tilt};
            double goal[2] = {};
            for (unsigned i = 0; i < 2; ++i)
                if (values[i] != 0) {
                    auto &a = axes_[i];
                    goal[i] = values[i] > 0 ? a.config.maximum : a.config.minimum;
                    Scales scales = scales_;
                    scales.speed *= std::abs(values[i]);
                    if (a.prepare(goal[i], scales) < 0)
                        return Error::Invalid;
                }
            for (unsigned i = 0; i < 2; ++i)
                if (values[i] != 0)
                    axes_[i].commit(goal[i], now);
            state_.jogging = true;
            jogPan_ = pan;
            jogTilt_ = tilt;
        }
        jogAt_ = heartbeat_ = now;
        return Error::Ok;
    }
    void stop(Error reason = Error::Stopped) {
        if (reason == Error::Timing && state_.fault != Error::Timing)
            ++state_.timingFaults;
        if (state().moving)
            state_.referenced = false;
        for (auto &a : axes_)
            a.cancel();
        state_.stopped = true;
        state_.fault = reason;
        state_.jogging = false;
        queued_.active = false;
        invalidate();
    }
    void tick(uint64_t now) {
        if (state_.armed && !state_.stopped && now >= lastTick_)
            state_.maxTickGapUs = std::max(state_.maxTickGapUs, now - lastTick_);
        if (now < lastTick_ || (state().moving && now - lastTick_ > 10000)) {
            state_.referenced = false;
            stop(Error::Timing);
        }
        lastTick_ = now;
        if (!state_.armed || state_.stopped)
            return;
        if (now - heartbeat_ >= 5000000) {
            stop();
            return;
        }
        if (state_.jogging && now - jogAt_ >= 500000) {
            for (auto &a : axes_)
                a.brake(now);
            state_.jogging = false;
        }
        for (auto &a : axes_)
            if (!a.tick(now)) {
                state_.referenced = false;
                stop(Error::Timing);
                return;
            }
        if (queued_.active && !axes_[0].moving && !axes_[1].moving) {
            const Target next = queued_;
            queued_.active = false;
            if (startMove(next.pan, next.tilt, next.speed, now) != Error::Ok)
                stop();
        }
    }
    // Longest time one timer callback has spent in the controller (set by the adapter).
    void noteTickCost(uint64_t microseconds) {
        state_.maxTickCostUs = std::max(state_.maxTickCostUs, microseconds);
    }

  private:
    struct Target {
        double pan = 0, tilt = 0, speed = 1;
        bool active = false;
    };
    std::array<Axis, 2> axes_{};
    State state_{};
    Config config_{};
    Scales scales_{};
    Target queued_{};
    double queuedDuration_ = 0;
    uint64_t lastTick_ = 0;
    uint64_t heartbeat_ = 0, jogAt_ = 0;
    double jogPan_ = 0, jogTilt_ = 0;
    void invalidate() {
        if (++state_.epoch == 0)
            state_.epoch = 1;
        state_.sequence = 0;
    }
    bool inRange(unsigned i, double value) const {
        return std::isfinite(value) && value >= axes_[i].config.minimum &&
               value <= axes_[i].config.maximum;
    }
    // Both axes must be idle. Plans each axis, then re-plans the quicker one stretched.
    Error startMove(double pan, double tilt, double speed, uint64_t now) {
        Scales scales = scales_;
        scales.speed *= speed;
        const double goal[] = {pan, tilt};
        double length[2];
        for (unsigned i = 0; i < 2; ++i)
            if ((length[i] = axes_[i].prepare(goal[i], scales)) < 0)
                return Error::Invalid;
        const double longest = std::max(length[0], length[1]);
        for (unsigned i = 0; i < 2; ++i)
            if (length[i] > 0 && length[i] < longest &&
                axes_[i].prepare(goal[i], scales, longest / length[i]) < 0)
                return Error::Invalid;
        for (unsigned i = 0; i < 2; ++i)
            axes_[i].commit(goal[i], now);
        return Error::Ok;
    }
};
} // namespace camx
