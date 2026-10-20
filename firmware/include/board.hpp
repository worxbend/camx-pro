#pragma once
#include <array>
namespace board {
// Physical ULN2003 labels IN1, IN2, IN3, IN4 (NOT AccelStepper's reordered pins).
inline constexpr std::array<std::array<int, 4>, 2> coils{{{{16, 17, 18, 19}}, {{21, 22, 23, 25}}}};
// Optional normally-closed-to-GND stop contact; open/high latches STOP.
// Set to 32 after wiring. Disabled by default because no switch is confirmed.
inline constexpr int stopPin = -1;
constexpr bool validPins() {
    unsigned used = 0;
    for (const auto &axis : coils)
        for (int pin : axis) {
            if (!(pin == 4 || pin == 13 || pin == 14 || (pin >= 16 && pin <= 19) ||
                  (pin >= 21 && pin <= 23) || (pin >= 25 && pin <= 27) || pin == 32 || pin == 33))
                return false;
            // GPIO32/33 need a separate bank; this adapter intentionally uses GPIO0–31.
            if (pin >= 32 || (used & (1u << pin)))
                return false;
            used |= 1u << pin;
        }
    return stopPin == -1 || stopPin == 32 || stopPin == 33;
}
static_assert(validPins(),
              "Choose unique, output-capable WROOM GPIOs; avoid strap/flash/UART pins");
} // namespace board
