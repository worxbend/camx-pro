// Controller features built on the jerk-limited profile: synchronized arrival, runtime
// speed/acceleration/jerk scales, retargeting, jogging, and the ETA diagnostic.
#include "camx/controller.hpp"
#include "test_random.hpp"
#include <algorithm>
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

namespace {
using camx::Controller;
using camx::Error;

// A controller driven by a 250 us timer (optionally jittered) that audits every tick:
// speed, acceleration and jerk ceilings, continuity, limits, step spacing and faults.
struct Rig {
    Controller c;
    uint64_t now = 0, lastBeat = 0;
    bool jitter;
    TestRandom rng;
    double peakV[2] = {}, peakA[2] = {}, peakJ[2] = {};
    uint64_t lastStep[2] = {};
    uint64_t ticks = 0;

    explicit Rig(bool withJitter = false, unsigned seed = 1, bool commissioned = false)
        : c(seed), jitter(withJitter), rng(seed) {
        if (commissioned) {
            auto config = c.config();
            config.commissioned = true;
            config.axis[0].minimum = -160;
            config.axis[0].maximum = 160;
            config.axis[1].minimum = -30;
            config.axis[1].maximum = 90;
            CHECK(c.configure(config) == Error::Ok);
        }
        CHECK(c.reference(0, 0) == Error::Ok);
        CHECK(c.arm(now) == Error::Ok);
    }
    void beat() {
        const auto s = c.state();
        CHECK(c.authorize(s.epoch, s.sequence + 1, now) == Error::Ok);
        lastBeat = now;
    }
    void tick() {
        if (now - lastBeat >= 1000000)
            beat();
        const auto config = c.config();
        double v[2], a[2];
        camx::State before = c.state();
        for (unsigned i = 0; i < 2; ++i) {
            v[i] = c.axis(i).velocity();
            a[i] = c.axis(i).acceleration();
        }
        const uint64_t delta = jitter ? 230 + rng() % 41 : 250;
        now += delta;
        c.tick(now);
        ++ticks;
        const auto after = c.state();
        CHECK(after.fault == Error::Ok && !after.stopped);
        for (unsigned i = 0; i < 2; ++i) {
            const auto &axis = c.axis(i);
            const auto &limits = config.axis[i];
            CHECK(std::abs(axis.steps - before.steps[i]) <= 1);
            CHECK(axis.steps >= limits.lowStep() && axis.steps <= limits.highStep());
            CHECK(std::abs(axis.velocity()) <= limits.speed + 1e-7);
            CHECK(std::abs(axis.acceleration()) <= limits.acceleration + 1e-7);
            CHECK(std::abs(axis.velocity() - v[i]) <= limits.acceleration * delta / 1e6 + 1e-7);
            CHECK(std::abs(axis.acceleration() - a[i]) <= limits.jerk * delta / 1e6 + 1e-7);
            peakV[i] = std::max(peakV[i], std::abs(axis.velocity()));
            peakA[i] = std::max(peakA[i], std::abs(axis.acceleration()));
            peakJ[i] = std::max(peakJ[i], std::abs(axis.acceleration() - a[i]) / (delta / 1e6));
            if (axis.steps != before.steps[i]) {
                CHECK(lastStep[i] == 0 || now - lastStep[i] >= 1250);
                lastStep[i] = now;
            }
        }
    }
    // Runs until nothing moves; returns the seconds it took.
    double settle(double limitSeconds = 60) {
        const uint64_t began = now;
        while (c.state().moving) {
            tick();
            if (now - began >= limitSeconds * 1e6) {
                const auto s = c.state();
                std::cerr << "stuck: queued=" << s.queued << " jogging=" << s.jogging << " steps "
                          << s.steps[0] << ',' << s.steps[1] << " moving " << c.axis(0).moving
                          << c.axis(1).moving << " braking " << c.axis(0).braking()
                          << c.axis(1).braking() << " dest " << c.axis(0).destination() << ','
                          << c.axis(1).destination() << " v " << c.axis(0).velocity() << ','
                          << c.axis(1).velocity() << " eta " << s.eta << '\n';
            }
            CHECK(now - began < limitSeconds * 1e6);
        }
        return (now - began) / 1e6;
    }
    void run(double seconds) {
        const uint64_t until = now + static_cast<uint64_t>(seconds * 1e6);
        while (now < until)
            tick();
    }
    void resetPeaks() { peakV[0] = peakV[1] = peakA[0] = peakA[1] = peakJ[0] = peakJ[1] = 0; }
};
} // namespace

int main() {
    // Defaults: a 1 degree move is smooth and quick, and the new ceilings are really reached.
    {
        Rig r;
        CHECK(r.c.move(1, 0, false, r.now) == Error::Ok);
        const double seconds = r.settle();
        CHECK(seconds > 0.7 && seconds < 1.0);
        CHECK(r.peakJ[0] > 0.9 * r.c.config().axis[0].jerk); // jerk-limited, not trapezoidal
        CHECK(r.peakA[0] > 0.9 * 7.0 - 1e-6 || r.peakA[0] > 5);
    }

    // Synchronized arrival: the short tilt move is stretched to take as long as the long pan.
    {
        Rig r;
        CHECK(r.c.move(20, 3, false, r.now) == Error::Ok);
        const double planned = r.c.state().eta;
        CHECK(planned > 5 && planned < 7);
        double donePan = -1, doneTilt = -1;
        const uint64_t began = r.now;
        while (r.c.state().moving) {
            r.tick();
            if (donePan < 0 && !r.c.axis(0).moving)
                donePan = (r.now - began) / 1e6;
            if (doneTilt < 0 && !r.c.axis(1).moving)
                doneTilt = (r.now - began) / 1e6;
        }
        CHECK(donePan > 0.95 * planned && doneTilt > 0.95 * planned);
        CHECK(std::abs(donePan - doneTilt) < 0.05 * planned);
        CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(20));
        CHECK(r.c.state().steps[1] == r.c.config().axis[1].quantize(3));
        // Alone, 3 degrees of tilt is far quicker and peaks at a higher speed.
        Rig solo;
        CHECK(solo.c.move(0, 3, false, solo.now) == Error::Ok);
        const double alone = solo.settle();
        CHECK(alone < 0.4 * planned);
        CHECK(solo.peakV[1] > 1.5 * r.peakV[1]);
        // Straight line: progress of the two axes stays proportional throughout.
        Rig line;
        CHECK(line.c.move(-18, 9, false, line.now) == Error::Ok);
        const double span[2] = {static_cast<double>(line.c.config().axis[0].quantize(-18)),
                                static_cast<double>(line.c.config().axis[1].quantize(9))};
        while (line.c.state().moving) {
            line.tick();
            const double f0 = line.c.state().steps[0] / span[0];
            const double f1 = line.c.state().steps[1] / span[1];
            CHECK(std::abs(f0 - f1) < 0.03 + 3 / std::abs(span[1]));
        }
    }

    // Runtime scales lower the ceilings without a settings change or a fresh reference.
    {
        Rig r;
        camx::Scales scales;
        scales.speed = 0.5;
        CHECK(r.c.setScales(scales) == Error::Ok);
        CHECK(r.c.state().scales.speed == 0.5);
        CHECK(r.c.move(15, 0, false, r.now) == Error::Ok);
        r.settle();
        CHECK(r.peakV[0] <= 2.0 + 1e-7 && r.peakV[0] > 1.9);
        CHECK(r.c.state().referenced);

        scales = {};
        scales.accel = 0.25;
        scales.jerk = 0.5;
        CHECK(r.c.setScales(scales) == Error::Ok);
        r.resetPeaks();
        CHECK(r.c.move(0, 0, false, r.now) == Error::Ok);
        r.settle();
        CHECK(r.peakA[0] <= 2.0 + 1e-7 && r.peakA[0] > 1.9);
        CHECK(r.peakJ[0] <= 40.0 + 1e-6 && r.peakJ[0] > 35);

        // A per-move speed multiplies the runtime scale and ends with the move.
        scales = {};
        scales.speed = 0.5;
        CHECK(r.c.setScales(scales) == Error::Ok);
        r.resetPeaks();
        CHECK(r.c.move(10, 0, false, r.now, 0.5) == Error::Ok);
        r.settle();
        CHECK(r.peakV[0] <= 1.0 + 1e-7 && r.peakV[0] > 0.95);
        r.resetPeaks();
        CHECK(r.c.move(0, 0, false, r.now) == Error::Ok);
        r.settle();
        CHECK(r.peakV[0] > 1.9 && r.peakV[0] <= 2.0 + 1e-7);

        for (double bad : {0.0, 0.049, 1.001, -1.0, double(NAN), double(INFINITY)}) {
            camx::Scales s;
            s.speed = bad;
            CHECK(r.c.setScales(s) == Error::Range);
            s = {};
            s.jerk = bad;
            CHECK(r.c.setScales(s) == Error::Range);
            CHECK(r.c.move(1, 1, false, r.now, bad) == Error::Range);
        }
        CHECK(r.c.state().scales.speed == 0.5 && !r.c.state().moving);
        // The slowest legal setting still plans and completes a move.
        scales = {};
        scales.speed = scales.accel = scales.jerk = camx::minScale;
        CHECK(r.c.setScales(scales) == Error::Ok);
        CHECK(r.c.move(1, 1, false, r.now) == Error::Ok);
        r.settle();
        CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(1));
    }

    // Braking a synchronized move is prompt on both axes: the stretched axis brakes with its
    // unstretched ceilings instead of creeping on. Retarget ETA and target include the queue.
    {
        for (int kind = 0; kind < 2; ++kind) {
            Rig r;
            CHECK(r.c.move(20, 0.2, false, r.now) == Error::Ok);
            r.run(2.0);
            if (kind == 0)
                CHECK(r.c.jog(0, 0, r.now) == Error::Ok);
            else
                CHECK(r.c.move(-5, 3, false, r.now, 1, true) == Error::Ok);
            const uint64_t braking = r.now;
            if (kind == 1) {
                const auto s = r.c.state();
                CHECK(s.queued && r.c.target(0) == -5 && r.c.target(1) == 3);
                const double expected = s.eta;
                while (r.c.state().queued)
                    r.tick();
                CHECK((r.now - braking) / 1e6 < 1.0); // both axes came to rest quickly
                r.settle();
                const double actual = (r.now - braking) / 1e6;
                CHECK(std::abs(actual - expected) < 0.08 * actual);
                CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(-5));
            } else {
                while (r.c.axis(1).moving)
                    r.tick();
                CHECK((r.now - braking) / 1e6 < 1.0);
                r.settle();
            }
        }
    }

    // A move that arrives while another is in progress is refused unless it retargets.
    {
        Rig r;
        CHECK(r.c.move(10, 5, false, r.now) == Error::Ok);
        r.run(0.5);
        CHECK(r.c.move(-10, 0, false, r.now) == Error::Busy);
        CHECK(r.c.move(-10, 0, true, r.now) == Error::Busy);
        CHECK(!r.c.state().queued);
        r.settle();
        CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(10));
    }

    // Retargeting brakes smoothly, never reverses abruptly, and ends exactly on the newest goal.
    {
        Rig r;
        CHECK(r.c.move(15, 10, false, r.now) == Error::Ok);
        r.run(1.0);
        const double speedBefore = r.c.axis(0).velocity();
        CHECK(speedBefore > 1);
        CHECK(r.c.move(-12, -8, false, r.now, 1, true) == Error::Ok);
        CHECK(r.c.state().queued && r.c.state().moving);
        CHECK(r.c.axis(0).braking());
        // Still heading the old way until the braking finishes, then reverses through rest.
        bool sawRest = false;
        while (r.c.state().queued) {
            r.tick();
            CHECK(r.c.axis(0).velocity() >= -1e-9 || sawRest);
            sawRest |= !r.c.axis(0).moving && !r.c.axis(1).moving;
        }
        CHECK(r.c.axis(0).steps > r.c.config().axis[0].quantize(0));
        r.settle();
        CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(-12));
        CHECK(r.c.state().steps[1] == r.c.config().axis[1].quantize(-8));
        CHECK(!r.c.state().queued && r.c.state().referenced);
    }

    // Repeating the target a move is already heading for does not restart or brake it.
    {
        Rig r;
        CHECK(r.c.move(12, 4, false, r.now) == Error::Ok);
        r.run(1.0);
        for (int i = 0; i < 20; ++i) {
            CHECK(r.c.move(12, 4, false, r.now, 1, true) == Error::Ok);
            CHECK(!r.c.state().queued && !r.c.axis(0).braking());
            r.run(0.05);
        }
        const double expected = r.c.config().axis[0].quantize(12);
        const double seconds = r.settle();
        CHECK(r.c.state().steps[0] == expected);
        CHECK(r.c.state().eta == 0 && seconds < 6);
        // The same, once idle: a retargeting move simply starts when nothing is moving.
        CHECK(r.c.move(0, 0, false, r.now, 1, true) == Error::Ok && !r.c.state().queued);
        r.settle();
    }

    // Relative moves accumulate on the pending target, and the latest request wins.
    {
        Rig r;
        CHECK(r.c.move(5, 0, false, r.now) == Error::Ok);
        r.run(0.4);
        CHECK(r.c.move(3, 0, true, r.now, 1, true) == Error::Ok);  // 5 + 3
        CHECK(r.c.move(2, 0, true, r.now, 1, true) == Error::Ok);  // pending 8 + 2
        CHECK(r.c.move(0, 7, false, r.now, 1, true) == Error::Ok); // replaces everything
        r.settle();
        CHECK(r.c.state().steps[0] == 0 &&
              r.c.state().steps[1] == r.c.config().axis[1].quantize(7));
        CHECK(r.c.move(5, 0, false, r.now) == Error::Ok);
        r.run(0.4);
        CHECK(r.c.move(3, 0, true, r.now, 1, true) == Error::Ok);
        CHECK(r.c.move(2, 0, true, r.now, 1, true) == Error::Ok);
        r.settle();
        CHECK(r.c.state().steps[0] == r.c.config().axis[0].quantize(10));
        // Out-of-range retargets are rejected and leave the move in progress alone.
        CHECK(r.c.move(-5, 0, false, r.now) == Error::Ok);
        r.run(0.3);
        CHECK(r.c.move(500, 0, false, r.now, 1, true) == Error::Range);
        CHECK(r.c.move(0, NAN, false, r.now, 1, true) == Error::Range);
        CHECK(!r.c.state().queued && !r.c.axis(0).braking());
        r.settle();
    }

    // STOP, jogging and release interact safely with a queued retarget.
    {
        Rig r;
        CHECK(r.c.move(10, 0, false, r.now) == Error::Ok);
        r.run(0.6);
        CHECK(r.c.move(-10, 0, false, r.now, 1, true) == Error::Ok && r.c.state().queued);
        CHECK(r.c.jog(1, 0, r.now) == Error::Busy);
        r.c.stop();
        CHECK(!r.c.state().queued && !r.c.state().moving && r.c.state().stopped);

        Rig brake;
        CHECK(brake.c.move(10, 0, false, brake.now) == Error::Ok);
        brake.run(0.6);
        CHECK(brake.c.move(-10, 0, false, brake.now, 1, true) == Error::Ok);
        CHECK(brake.c.jog(0, 0, brake.now) == Error::Ok);
        CHECK(!brake.c.state().queued);
        brake.settle();
        const int32_t rested = brake.c.state().steps[0];
        CHECK(rested > 0 && rested < brake.c.config().axis[0].quantize(10));
        brake.run(0.5);
        CHECK(brake.c.state().steps[0] == rested);

        Rig disarm;
        CHECK(disarm.c.move(10, 0, false, disarm.now) == Error::Ok);
        disarm.run(0.6);
        CHECK(disarm.c.move(-10, 0, false, disarm.now, 1, true) == Error::Ok);
        disarm.c.disarm();
        CHECK(!disarm.c.state().queued && !disarm.c.state().moving && disarm.c.coils(0) == 0);

        Rig jogging;
        CHECK(jogging.c.jog(1, 0, jogging.now) == Error::Ok);
        jogging.run(0.4);
        CHECK(jogging.c.move(0, 0, false, jogging.now, 1, true) == Error::Busy);
        CHECK(!jogging.c.state().queued);
    }

    // ETA: matches the plan, counts down, and is zero at rest.
    {
        Rig r;
        CHECK(r.c.state().eta == 0);
        CHECK(r.c.move(10, 0, false, r.now) == Error::Ok);
        const double planned = r.c.state().eta;
        double last = planned;
        const uint64_t began = r.now;
        while (r.c.state().moving) {
            r.tick();
            CHECK(r.c.state().eta <= last + 1e-9);
            last = r.c.state().eta;
        }
        CHECK(std::abs(planned - (r.now - began) / 1e6) < 0.05 * planned);
        CHECK(r.c.state().eta == 0);
    }

    // Jogging uses the S-curve too: held jog reaches the scaled speed, release stops smoothly,
    // and a jog that runs into the end of travel finishes exactly on the limit.
    {
        Rig r;
        camx::Scales scales;
        scales.speed = 0.5;
        CHECK(r.c.setScales(scales) == Error::Ok);
        CHECK(r.c.jog(0.5, -1, r.now) == Error::Ok);
        for (int i = 0; i < 20; ++i) {
            r.run(0.1);
            CHECK(r.c.jog(0.5, -1, r.now) == Error::Ok);
        }
        CHECK(r.peakV[0] > 0.9 && r.peakV[0] <= 1.0 + 1e-7); // 4 * 0.5 * 0.5 deg/s
        CHECK(r.peakV[1] > 1.9 && r.peakV[1] <= 2.0 + 1e-7); // 4 * 0.5 deg/s
        CHECK(r.c.jog(0, 0, r.now) == Error::Ok);
        const double stopping = r.settle();
        CHECK(stopping > 0.1 && stopping < 2);
        CHECK(r.c.state().referenced && !r.c.state().jogging);
        const int32_t pan = r.c.state().steps[0];
        CHECK(pan > 0 && pan < r.c.config().axis[0].highStep());

        Rig edge;
        CHECK(edge.c.jog(1, 0, edge.now) == Error::Ok);
        while (edge.c.state().moving) {
            edge.tick();
            if (edge.c.state().jogging && edge.now % 100000 < 250)
                CHECK(edge.c.jog(1, 0, edge.now) == Error::Ok);
        }
        CHECK(edge.c.state().steps[0] == edge.c.config().axis[0].highStep());
    }

    // Randomized retargeting and braking under timer jitter: every tick is audited by Rig.
    int events = 0, retargets = 0;
    for (unsigned trial = 0; trial < 120; ++trial) {
        Rig r(true, 100 + trial, trial % 2);
        TestRandom pick(trial + 7);
        auto uniform = [&](double lo, double hi) {
            return lo + (hi - lo) * std::generate_canonical<double, 32>(pick);
        };
        const auto limits = r.c.config();
        double goal[2] = {0, 0};
        bool braked = false;
        for (int move = 0; move < 12; ++move) {
            r.run(uniform(0.05, 1.4));
            const double speed = uniform(0.2, 1);
            const unsigned kind = pick() % 8;
            if (kind == 0) {
                CHECK(r.c.jog(0, 0, r.now) == Error::Ok); // brake to a stop mid-flight
                braked = true;
            } else if (kind == 1 && !r.c.state().moving) {
                CHECK(r.c.move(0, 0, false, r.now, speed, true) == Error::Ok);
                goal[0] = goal[1] = 0;
                braked = false;
            } else {
                // Commissioned trials may travel further, but keep each run to simulated minutes.
                goal[0] = uniform(std::max(limits.axis[0].minimum, -30.0),
                                  std::min(limits.axis[0].maximum, 30.0));
                goal[1] = uniform(std::max(limits.axis[1].minimum, -20.0),
                                  std::min(limits.axis[1].maximum, 20.0));
                const bool queued = r.c.state().moving;
                CHECK(r.c.move(goal[0], goal[1], false, r.now, speed, true) == Error::Ok);
                if (queued)
                    ++retargets;
                braked = false;
            }
            ++events;
        }
        r.settle(120);
        CHECK(!r.c.state().queued && r.c.state().referenced);
        if (!braked) {
            CHECK(r.c.state().steps[0] == limits.axis[0].quantize(goal[0]));
            CHECK(r.c.state().steps[1] == limits.axis[1].quantize(goal[1]));
        }
    }
    CHECK(events == 1440 && retargets > 300);

    std::cout << "synchronized arrival, runtime scales, retargeting, jog and ETA (" << events
              << " randomized events, " << retargets << " mid-move retargets): PASS\n";
}
