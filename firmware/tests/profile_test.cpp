// Property tests for the jerk-limited profile: ceilings, continuity, closed forms, time
// stretching, inverse lookups and stopping from arbitrary mid-move states.
#include "camx/profile.hpp"
#include <cstdlib>
#include <iostream>
#include <random>

#define CHECK(c)                                                                                   \
    do {                                                                                           \
        if (!(c)) {                                                                                \
            std::cerr << __FILE__ << ':' << __LINE__ << ": " #c "\n";                              \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)

using camx::Limits;
using camx::Profile;

namespace {
struct Sample {
    double x, v, a;
};
Sample at(const Profile &p, double t) {
    Sample s{};
    p.evaluate(t, s.x, s.v, s.a);
    return s;
}

// Central differences must agree with the analytic velocity and acceleration, acceleration
// and jerk must respect their ceilings, and the position must never go backwards.
void audit(const Profile &p, const Limits &l, double aCeiling, double vCeiling, std::mt19937 &rng) {
    const double h = 1e-5, T = p.duration();
    double previous = 0;
    const int samples = 400;
    for (int i = 0; i <= samples; ++i) {
        const double t = i == samples ? T : T * i / samples;
        const auto s = at(p, t);
        CHECK(s.x >= previous - 1e-9);
        previous = s.x;
        CHECK(s.v >= 0 && s.v <= vCeiling * (1 + 1e-9) + 1e-9);
        CHECK(std::abs(s.a) <= aCeiling * (1 + 1e-9) + 1e-9);
    }
    for (int i = 0; i < 200; ++i) {
        const double t = h + (T - 2 * h) * std::generate_canonical<double, 32>(rng);
        if (T < 4 * h)
            break;
        const auto lo = at(p, t - h), mid = at(p, t), hi = at(p, t + h);
        CHECK(std::abs((hi.x - lo.x) / (2 * h) - mid.v) <= 1e-6 + l.jerk * h * h + 1e-9 * mid.v);
        CHECK(std::abs((hi.v - lo.v) / (2 * h) - mid.a) <= 2 * l.jerk * h + 1e-6);
        CHECK(std::abs(hi.a - lo.a) / (2 * h) <= l.jerk * (1 + 1e-6) + 1e-6);
    }
    const auto end = at(p, T);
    CHECK(end.v == 0 && end.a == 0);
    const auto near = at(p, T - 1e-7);
    CHECK(near.v <= aCeiling * 1e-6 + 1e-6);
}
} // namespace

int main() {
    std::mt19937 rng(20261021);
    auto uniform = [&](double lo, double hi) {
        return lo + (hi - lo) * std::generate_canonical<double, 32>(rng);
    };
    auto logUniform = [&](double lo, double hi) {
        return std::exp(uniform(std::log(lo), std::log(hi)));
    };

    // Rest to rest: every regime (v-limited ramp, a-limited, with and without cruise).
    int cruising = 0, accelLimited = 0, triangular = 0, smooth = 0;
    for (int trial = 0; trial < 4000; ++trial) {
        const Limits l{logUniform(1, 2000), logUniform(1, 5000), logUniform(1, 50000)};
        const double d = std::floor(logUniform(1, 30000));
        Profile p;
        CHECK(p.planRestToRest(d, l));
        CHECK(p.distance() == d && p.duration() > 0);
        audit(p, l, l.acceleration, l.velocity, rng);
        const double ramp = l.velocity * l.jerk >= l.acceleration * l.acceleration
                                ? l.acceleration / l.jerk
                                : std::sqrt(l.velocity / l.jerk);
        const double span =
            l.velocity * (2 * ramp + (l.velocity * l.jerk >= l.acceleration * l.acceleration
                                          ? l.velocity / l.acceleration - ramp
                                          : 0));
        if (d >= span) {
            // Closed forms for the full-speed case.
            const bool aLimited = l.velocity * l.jerk >= l.acceleration * l.acceleration;
            const double expected =
                aLimited ? d / l.velocity + l.acceleration / l.jerk + l.velocity / l.acceleration
                         : d / l.velocity + 2 * std::sqrt(l.velocity / l.jerk);
            CHECK(std::abs(p.duration() - expected) <= 1e-9 * expected);
            ++cruising;
            // The cruise really reaches the speed ceiling.
            double top = 0;
            for (int i = 0; i <= 400; ++i)
                top = std::max(top, at(p, p.duration() * i / 400).v);
            CHECK(top >= l.velocity * (1 - 1e-3));
        } else if (d >= 2 * std::pow(l.acceleration, 3) / (l.jerk * l.jerk)) {
            ++accelLimited;
        } else {
            ++triangular;
        }

        // Stretching in time keeps the shape and respects the scaled ceilings.
        const double k = uniform(1, 40);
        Profile slow;
        CHECK(slow.planRestToRest(d, l.stretched(k)));
        CHECK(std::abs(slow.duration() - k * p.duration()) <= 1e-9 * k * p.duration());
        for (int i = 0; i <= 20; ++i) {
            const double t = p.duration() * i / 20;
            const auto fast = at(p, t), stretched = at(slow, k * t);
            CHECK(std::abs(fast.x - stretched.x) <= 1e-7 * d + 1e-7);
            CHECK(std::abs(fast.v / k - stretched.v) <= 1e-7 * l.velocity / k + 1e-9);
            CHECK(std::abs(fast.a / (k * k) - stretched.a) <=
                  1e-7 * l.acceleration / (k * k) + 1e-9);
        }

        // Inverse lookup: reaching a position, from any starting hint, is accurate and
        // never early enough for the position to be short of the target.
        for (int i = 0; i < 20; ++i) {
            const double target = uniform(1e-3, d - 1e-3);
            for (double hint : {0.0, p.duration(), uniform(0, p.duration())}) {
                const double t = p.timeAt(target, hint);
                CHECK(t >= 0 && t <= p.duration());
                const double x = at(p, t).x;
                CHECK(std::abs(x - target) <= 1e-6);
                ++smooth;
            }
        }
        CHECK(p.timeAt(0, 0) == 0 && p.timeAt(d, 0) == p.duration());
    }
    CHECK(cruising > 200 && accelLimited > 200 && triangular > 200);

    // Stopping from any state that a rest-to-rest move can be in: it must end at rest, honour
    // the ceilings and never need more distance than the move had left.
    int stops = 0, jerkPhase = 0;
    for (int trial = 0; trial < 3000; ++trial) {
        const Limits l{logUniform(1, 2000), logUniform(1, 5000), logUniform(1, 50000)};
        const double d = std::floor(logUniform(2, 30000));
        Profile move;
        CHECK(move.planRestToRest(d, l));
        for (int i = 0; i < 40; ++i) {
            const double t = uniform(0, move.duration());
            const auto state = at(move, t);
            Profile stop;
            CHECK(stop.planStop(state.v, state.a, l));
            const auto start = at(stop, 0);
            CHECK(std::abs(start.v - state.v) <= 1e-9 * (1 + state.v));
            CHECK(std::abs(start.a - state.a) <= 1e-9 * (1 + std::abs(state.a)));
            const double aLimit = std::max(l.acceleration, std::abs(state.a));
            // While the acceleration is still being ramped down the speed may overshoot by
            // a^2/2j before it falls, but never beyond this bound.
            const double vLimit = state.v + (state.a > 0 ? state.a * state.a / (2 * l.jerk) : 0);
            audit(stop, l, aLimit, vLimit, rng);
            CHECK(stop.distance() <= d - state.x + 1e-6 * (1 + d));
            ++stops;
            jerkPhase += state.a != 0;
        }
    }
    CHECK(stops == 120000 && jerkPhase > 40000);

    // Degenerate input is refused or empty, never half-built.
    Profile p;
    CHECK(!p.planRestToRest(10, Limits{0, 1, 1}));
    CHECK(!p.planRestToRest(10, Limits{1, NAN, 1}));
    CHECK(p.planRestToRest(0, Limits{1, 1, 1}) && p.duration() == 0 && p.distance() == 0);
    CHECK(p.planStop(0, 0, Limits{1, 1, 1}) && p.duration() == 0);
    CHECK(!p.planStop(1, 0, Limits{1, 1, 0}));
    CHECK(at(p, 5).x == 0);
    std::cout << "S-curve ceilings, closed forms, stretching, inverse lookup and " << stops
              << " mid-move stops (" << smooth << " lookups): PASS\n";
}
