#include "camx/controller.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>

#define CHECK(condition)                                                                           \
    do {                                                                                           \
        if (!(condition)) {                                                                        \
            std::cerr << __FILE__ << ':' << __LINE__ << ": " #condition "\n";                      \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)

int main() {
    camx::Controller controller(123);
    CHECK(!controller.state().armed);
    CHECK(!controller.state().referenced);
    CHECK(controller.coils(0) == 0 && controller.coils(1) == 0);
    CHECK(controller.move(1, 1, false, 0) == camx::Error::NotArmed);
    CHECK(controller.reference(0, 0) == camx::Error::Ok);
    CHECK(controller.arm(0) == camx::Error::Ok);
    CHECK(controller.move(1, 1, false, 0) == camx::Error::Ok);
    for (uint64_t us = 250; us <= 1000000; us += 250)
        controller.tick(us);
    CHECK(controller.state().steps[0] == 46);
    CHECK(controller.state().steps[1] == 23);
    CHECK(!controller.state().moving);
    const uint32_t epoch = controller.state().epoch;
    CHECK(controller.authorize(epoch, 1, 1000000) == camx::Error::Ok);
    CHECK(controller.authorize(epoch, 1, 1000000) == camx::Error::Stale);
    controller.stop();
    CHECK(controller.authorize(epoch, 2, 1000000) == camx::Error::Stale);
    CHECK(controller.move(0, 0, false, 1000000) == camx::Error::Stopped);
    controller.disarm();
    CHECK(!controller.state().referenced);
    CHECK(controller.coils(0) == 0);
    CHECK(controller.arm(1000000) == camx::Error::Stopped);
    CHECK(controller.reference(0, 0) == camx::Error::Ok);
    CHECK(controller.arm(1000000) == camx::Error::Ok);
    CHECK(controller.jog(1, -1, 1000000) == camx::Error::Ok);
    // The lease lapses at 1.5 s; the jerk-limited stop from about 3.6 deg/s takes ~0.7 s.
    for (uint64_t us = 1000250; us <= 3000000; us += 250)
        controller.tick(us);
    CHECK(!controller.state().moving);
    CHECK(controller.state().referenced);
    CHECK(controller.state().steps[0] > 0 && controller.state().steps[1] < 0);
    controller.tick(7000000);
    CHECK(controller.state().stopped);
    CHECK(controller.coils(0) != 0); // lost controller holds load
    camx::Controller configTest(4);
    auto settings = configTest.config();
    settings.axis[0].minimum = -160;
    CHECK(configTest.configure(settings) == camx::Error::Invalid);
    settings.commissioned = true;
    CHECK(configTest.configure(settings) == camx::Error::Ok);
    settings.axis[0].motorSteps = NAN;
    CHECK(configTest.configure(settings) == camx::Error::Invalid);
    camx::Controller jitter(12);
    auto fast = jitter.config();
    fast.commissioned = true;
    fast.axis[0].minimum = -160;
    fast.axis[0].maximum = 160;
    fast.axis[0].speed = 800 / fast.axis[0].stepsPerDegree();
    fast.axis[0].acceleration = 20;
    CHECK(jitter.configure(fast) == camx::Error::Ok);
    CHECK(jitter.reference(0, 0) == camx::Error::Ok);
    CHECK(jitter.arm(0) == camx::Error::Ok);
    CHECK(jitter.move(150, 0, false, 0) == camx::Error::Ok);
    for (uint64_t us = 270; us < 2000000; us += (us % 500 ? 230 : 270))
        jitter.tick(us);
    CHECK(jitter.state().fault == camx::Error::Ok);
    camx::Controller tiny(14);
    CHECK(tiny.reference(0, 0) == camx::Error::Ok);
    CHECK(tiny.arm(0) == camx::Error::Ok);
    CHECK(tiny.jog(std::numeric_limits<double>::denorm_min(), 0, 0) == camx::Error::Range);
    std::cout << "boot, reference, dual-axis geared move: PASS\n";
}
