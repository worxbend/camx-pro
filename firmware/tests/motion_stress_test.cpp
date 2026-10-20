#include "camx/controller.hpp"
#include <cstdlib>
#include <iostream>
#include <random>

#define CHECK(c)                                                                                   \
    do {                                                                                           \
        if (!(c)) {                                                                                \
            std::cerr << __LINE__ << ": " #c "\n";                                                 \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)
int main() {
    // Exact emitted coil sequence, inversion and fractional relative accumulation.
    camx::Controller c(1);
    CHECK(c.reference(0, 0) == camx::Error::Ok);
    CHECK(c.arm(0) == camx::Error::Ok);
    uint64_t now = 0;
    for (int move = 0; move < 100; ++move) {
        CHECK(c.move(0.001, 0, true, now) == camx::Error::Ok);
        for (int tick = 0; tick < 2000 && c.state().moving; ++tick)
            c.tick(now += 250);
        CHECK(!c.state().moving && !c.state().stopped);
    }
    CHECK(c.state().steps[0] == 5);
    CHECK(std::abs(c.axis(0).requested - 0.1) < 1e-10);
    const auto oldPhase = c.axis(0).phase;
    CHECK(c.move(-0.02, 0, true, now) == camx::Error::Ok);
    while (c.state().moving)
        c.tick(now += 250);
    CHECK(c.axis(0).phase == (oldPhase + 7) % 8);
    CHECK(c.coils(0) == camx::halfSteps[c.axis(0).phase]);
    c.stop();
    const auto frozen = c.state().steps;
    for (int tick = 0; tick < 1000; ++tick)
        c.tick(now += 250);
    CHECK(c.state().steps == frozen && c.state().referenced);

    std::mt19937 random(42);
    size_t physicalSteps = 0;
    for (int trial = 0; trial < 300; ++trial) {
        camx::Controller machine(static_cast<uint32_t>(trial + 1));
        auto config = machine.config();
        config.commissioned = true;
        config.axis[0].minimum = -160;
        config.axis[0].maximum = 160;
        config.axis[1].minimum = -30;
        config.axis[1].maximum = 90;
        for (auto &axis : config.axis) {
            axis.motorSteps = 4000 + random() % 200;
            axis.speed = (trial % 5 == 0 ? 800.0 : 50.0 + random() % 700) / axis.stepsPerDegree();
            axis.acceleration = 2 + random() % 19;
            axis.inverted = random() % 2;
        }
        if (machine.configure(config) != camx::Error::Ok) {
            std::cerr.precision(17);
            std::cerr << "trial " << trial << " rates "
                      << config.axis[0].speed * config.axis[0].stepsPerDegree() << ' '
                      << config.axis[1].speed * config.axis[1].stepsPerDegree() << '\n';
            CHECK(false);
        }
        CHECK(machine.reference(0, 0) == camx::Error::Ok);
        // Start beyond the 32-bit microsecond rollover to exercise the 64-bit clock.
        now = (uint64_t(1) << 32) - 1000;
        CHECK(machine.arm(now) == camx::Error::Ok);
        const double pan = (static_cast<int>(random() % 400) - 200) / 10.0;
        const double tilt = (static_cast<int>(random() % 300) - 150) / 10.0;
        CHECK(machine.move(pan, tilt, false, now) == camx::Error::Ok);
        uint64_t lastStep[2] = {}, heartbeat = now;
        uint32_t sequence = 0;
        unsigned iterations = 0;
        while (machine.state().moving) {
            CHECK(++iterations < 400000);
            const auto before = machine.state();
            const double velocities[] = {machine.axis(0).velocity(), machine.axis(1).velocity()};
            const uint8_t phases[] = {machine.axis(0).phase, machine.axis(1).phase};
            const uint64_t delta = trial % 2 ? 251 : 230 + random() % 41;
            now += delta;
            if (now - heartbeat > 1000000) {
                CHECK(machine.authorize(machine.state().epoch, ++sequence, now) == camx::Error::Ok);
                heartbeat = now;
            }
            machine.tick(now);
            CHECK(machine.state().fault == camx::Error::Ok);
            for (unsigned i = 0; i < 2; ++i) {
                const auto &axis = machine.axis(i);
                const int32_t emitted = axis.steps - before.steps[i];
                CHECK(std::abs(emitted) <= 1);
                CHECK(axis.steps >= config.axis[i].lowStep() &&
                      axis.steps <= config.axis[i].highStep());
                CHECK(std::abs(axis.velocity()) <= config.axis[i].speed + 1e-7);
                CHECK(std::abs(axis.velocity() - velocities[i]) <=
                      config.axis[i].acceleration * delta / 1000000.0 + 1e-7);
                if (emitted) {
                    CHECK(lastStep[i] == 0 || now - lastStep[i] >= 1250);
                    const int direction =
                        (emitted > 0 ? 1 : -1) * (config.axis[i].inverted ? -1 : 1);
                    CHECK(axis.phase == (phases[i] + direction + 8) % 8);
                    lastStep[i] = now;
                    ++physicalSteps;
                }
            }
        }
        CHECK(machine.state().steps[0] == config.axis[0].quantize(pan));
        CHECK(machine.state().steps[1] == config.axis[1].quantize(tilt));
    }
    camx::Controller stall(99);
    CHECK(stall.reference(0, 0) == camx::Error::Ok);
    CHECK(stall.arm(0) == camx::Error::Ok);
    CHECK(stall.move(10, 10, false, 0) == camx::Error::Ok);
    stall.tick(10001);
    CHECK(stall.state().fault == camx::Error::Timing && !stall.state().referenced);
    CHECK(stall.state().steps[0] == 0 && stall.coils(0) != 0);
    std::cout << "300 randomized dual-axis trajectories, " << physicalSteps
              << " emitted half-steps, acceleration/spacing/phase/limits/rollover: PASS\n";
}
