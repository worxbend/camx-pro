#pragma once
#include "axis.hpp"
#include "mechanics.hpp"
#include <array>

namespace camx {
struct Config {
    std::array<AxisConfig, 2> axis{{{mechanics::motorSteps, mechanics::panReduction, -20, 20,
                                     mechanics::panSpeed, mechanics::acceleration, false},
                                    {mechanics::motorSteps, mechanics::tiltReduction, -15, 15,
                                     mechanics::tiltSpeed, mechanics::acceleration, false}}};
    bool commissioned = false;
};
inline bool validConfig(const Config &c) {
    const double low[] = {mechanics::panMinimum, mechanics::tiltMinimum};
    const double high[] = {mechanics::panMaximum, mechanics::tiltMaximum};
    const double reductions[] = {mechanics::panReduction, mechanics::tiltReduction};
    for (unsigned i = 0; i < 2; ++i) {
        const auto &a = c.axis[i];
        for (double value :
             {a.motorSteps, a.reduction, a.minimum, a.maximum, a.speed, a.acceleration})
            if (!std::isfinite(value))
                return false;
        if (a.motorSteps < 2000 || a.motorSteps > 6000 || a.reduction != reductions[i] ||
            a.minimum < low[i] || a.minimum > 0 || a.maximum > high[i] || a.maximum < 0 ||
            a.maximum - a.minimum < 1 || a.speed < 0.1 || a.acceleration < 0.1 ||
            a.acceleration > 20 || a.speed * a.stepsPerDegree() > mechanics::maxStepRate + 1e-9)
            return false;
        if (!c.commissioned &&
            (a.minimum < (i == 0 ? -20 : -15) || a.maximum > (i == 0 ? 20 : 15) || a.speed > 4 ||
             a.acceleration > 8))
            return false;
    }
    return true;
}
} // namespace camx
