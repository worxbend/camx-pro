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
    std::array<int32_t, 2> steps{};
    uint32_t epoch = 1, sequence = 0;
    Error fault = Error::Ok;
    uint64_t maxTickGapUs = 0;
    uint32_t timingFaults = 0;
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
        for (unsigned i = 0; i < 2; ++i) {
            s.steps[i] = axes_[i].steps;
            s.moving |= axes_[i].moving;
        }
        return s;
    }
    const Axis &axis(unsigned i) const { return axes_[i]; }
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
        invalidate();
        return Error::Ok;
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
        invalidate();
    }
    Error move(double pan, double tilt, bool relative, uint64_t now) {
        if (state_.stopped)
            return Error::Stopped;
        if (!state_.armed)
            return Error::NotArmed;
        if (state().moving || state_.jogging)
            return Error::Busy;
        if (relative) {
            pan += axes_[0].requested;
            tilt += axes_[1].requested;
        }
        if (!inRange(0, pan) || !inRange(1, tilt))
            return Error::Range;
        axes_[0].begin(pan, now);
        axes_[1].begin(tilt, now);
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
            for (auto &a : axes_)
                a.brake(now);
            state_.jogging = false;
        } else if (state_.jogging && jogPan_ == pan && jogTilt_ == tilt) {
            // Lease renewal only: do not restart a profile or append a move.
        } else {
            if (state().moving || state_.jogging)
                return Error::Busy;
            const double values[] = {pan, tilt};
            for (unsigned i = 0; i < 2; ++i)
                if (values[i] != 0) {
                    auto &a = axes_[i];
                    a.begin(values[i] > 0 ? a.config.maximum : a.config.minimum, now,
                            std::abs(values[i]));
                }
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
                break;
            }
    }

  private:
    std::array<Axis, 2> axes_{};
    State state_{};
    Config config_{};
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
};
} // namespace camx
