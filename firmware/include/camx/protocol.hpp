#pragma once
#include "controller.hpp"
#include "json.hpp"

namespace camx {
struct Preset {
    double pan = 0, tilt = 0;
    bool valid = false;
};
class Device {
  public:
    Controller controller;
    std::array<Preset, 8> presets{};
    bool dirty = false;
    explicit Device(uint32_t epoch) : controller(epoch) {}

    Error execute(std::string_view input, uint64_t now) {
        Packet p;
        if (!parsePacket(input, p))
            return Error::Invalid;
        return execute(p, now);
    }
    Error execute(const Packet &p, uint64_t now) {
        const auto *op = p.get("op");
        if (!op || op->type != Field::Type::Text)
            return Error::Invalid;
        const auto name = op->text;
        // Authenticated STOP intentionally bypasses sequencing, including stale sessions.
        if (name == "stop" && p.only({"op", "epoch", "seq"})) {
            controller.stop();
            return Error::Ok;
        }
        if (name == "state" && p.only({"op"}))
            return Error::Ok;
        uint32_t epoch = 0, seq = 0;
        if (!p.integer("epoch", epoch) || !p.integer("seq", seq))
            return Error::Invalid;
        auto authorized = controller.authorize(epoch, seq, now);
        if (authorized != Error::Ok)
            return authorized;
        if (name == "move" || name == "relative" || name == "reference" || name == "jog") {
            double pan = 0, tilt = 0;
            if (!p.only({"op", "epoch", "seq", "pan", "tilt"}) || !p.number("pan", pan) ||
                !p.number("tilt", tilt))
                return Error::Invalid;
            if (name == "reference")
                return controller.reference(pan, tilt);
            if (name == "jog")
                return controller.jog(pan, tilt, now);
            return controller.move(pan, tilt, name == "relative", now);
        }
        if (name == "settings")
            return settings(p);
        if (name == "preset_set" || name == "preset_move") {
            uint32_t slot = 0;
            if (!p.integer("slot", slot) || slot >= presets.size())
                return Error::Invalid;
            if (name == "preset_move") {
                if (!p.only({"op", "epoch", "seq", "slot"}) || !presets[slot].valid)
                    return Error::Invalid;
                return controller.move(presets[slot].pan, presets[slot].tilt, false, now);
            }
            if (!p.only({"op", "epoch", "seq", "slot", "pan", "tilt"}))
                return Error::Invalid;
            if (controller.state().armed)
                return Error::Busy;
            Preset preset;
            if (!p.number("pan", preset.pan) || !p.number("tilt", preset.tilt) ||
                !validPreset(preset))
                return Error::Range;
            preset.valid = true;
            presets[slot] = preset;
            dirty = true;
            return Error::Ok;
        }
        if (!p.only({"op", "epoch", "seq"}))
            return Error::Invalid;
        if (name == "arm")
            return controller.arm(now);
        if (name == "disarm") {
            controller.disarm();
            return Error::Ok;
        }
        if (name == "center")
            return controller.move(0, 0, false, now);
        if (name == "heartbeat")
            return Error::Ok;
        return Error::Invalid; // No fake sensor homing or legacy servo calibration.
    }
    bool validPreset(const Preset &p) const {
        const auto c = controller.config();
        return std::isfinite(p.pan) && std::isfinite(p.tilt) && p.pan >= c.axis[0].minimum &&
               p.pan <= c.axis[0].maximum && p.tilt >= c.axis[1].minimum &&
               p.tilt <= c.axis[1].maximum;
    }

  private:
    Error settings(const Packet &p) {
        if (!p.only({"op", "epoch", "seq", "commissioned", "pan_steps", "tilt_steps", "pan_min",
                     "pan_max", "tilt_min", "tilt_max", "pan_speed", "tilt_speed", "pan_accel",
                     "tilt_accel", "pan_inverted", "tilt_inverted"}))
            return Error::Invalid;
        auto c = controller.config();
        auto number = [&](const char *key, double &value) {
            return !p.get(key) || p.number(key, value);
        };
        auto boolean = [&](const char *key, bool &value) {
            const auto *field = p.get(key);
            if (!field)
                return true;
            if (field->type != Field::Type::Boolean)
                return false;
            value = field->number != 0;
            return true;
        };
        if (!number("pan_steps", c.axis[0].motorSteps) ||
            !number("tilt_steps", c.axis[1].motorSteps) || !number("pan_min", c.axis[0].minimum) ||
            !number("pan_max", c.axis[0].maximum) || !number("tilt_min", c.axis[1].minimum) ||
            !number("tilt_max", c.axis[1].maximum) || !number("pan_speed", c.axis[0].speed) ||
            !number("tilt_speed", c.axis[1].speed) ||
            !number("pan_accel", c.axis[0].acceleration) ||
            !number("tilt_accel", c.axis[1].acceleration) ||
            !boolean("pan_inverted", c.axis[0].inverted) ||
            !boolean("tilt_inverted", c.axis[1].inverted) ||
            !boolean("commissioned", c.commissioned))
            return Error::Invalid;
        auto result = controller.configure(c);
        if (result == Error::Ok) {
            for (auto &preset : presets)
                if (preset.valid && !validPreset(preset))
                    preset.valid = false;
            dirty = true;
        }
        return result;
    }
};
} // namespace camx
