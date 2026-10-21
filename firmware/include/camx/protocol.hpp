#pragma once
#include "controller.hpp"
#include "json.hpp"
#include <cstring>

namespace camx {
inline constexpr size_t presetNameCapacity = 16;

struct Preset {
    double pan = 0, tilt = 0;
    bool valid = false;
    char name[presetNameCapacity + 1] = {};
};
// Names are printable ASCII without '"' and '\\', so they can be written into JSON as is.
inline bool validPresetName(std::string_view name) {
    if (name.size() > presetNameCapacity)
        return false;
    for (char c : name)
        if (c < 0x20 || c > 0x7e || c == '"' || c == '\\')
            return false;
    return true;
}
inline void setPresetName(Preset &preset, std::string_view name) {
    std::memset(preset.name, 0, sizeof(preset.name));
    std::memcpy(preset.name, name.data(), name.size());
}
// Where the mechanism rested the last time the operator released the motors. It is only a
// hint for the operator's next manual reference; the firmware never trusts it on its own.
struct Pose {
    double pan = 0, tilt = 0;
    bool valid = false;
};

class Device {
  public:
    Controller controller;
    std::array<Preset, 8> presets{};
    Pose lastPose{};
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
        if (name == "reference" || name == "jog") {
            double pan = 0, tilt = 0;
            if (!p.only({"op", "epoch", "seq", "pan", "tilt"}) || !p.number("pan", pan) ||
                !p.number("tilt", tilt))
                return Error::Invalid;
            return name == "reference" ? controller.reference(pan, tilt)
                                       : controller.jog(pan, tilt, now);
        }
        if (name == "move" || name == "relative") {
            double pan = 0, tilt = 0, speed = 1;
            bool retarget = false;
            if (!p.only({"op", "epoch", "seq", "pan", "tilt", "speed", "retarget"}) ||
                !p.number("pan", pan) || !p.number("tilt", tilt) ||
                !moveOptions(p, speed, retarget))
                return Error::Invalid;
            return controller.move(pan, tilt, name == "relative", now, speed, retarget);
        }
        if (name == "center") {
            double speed = 1;
            bool retarget = false;
            if (!p.only({"op", "epoch", "seq", "speed", "retarget"}) ||
                !moveOptions(p, speed, retarget))
                return Error::Invalid;
            return controller.move(0, 0, false, now, speed, retarget);
        }
        if (name == "settings")
            return settings(p);
        if (name == "motion")
            return motion(p);
        if (name.substr(0, 7) == "preset_")
            return preset(name, p, now);
        if (!p.only({"op", "epoch", "seq"}))
            return Error::Invalid;
        if (name == "arm") {
            const Error armed = controller.arm(now);
            if (armed == Error::Ok)
                forgetPose(); // see prepareArm()
            return armed;
        }
        if (name == "disarm") {
            rememberPose();
            controller.disarm();
            return Error::Ok;
        }
        if (name == "heartbeat")
            return Error::Ok;
        return Error::Invalid; // Sensor homing and pulse calibration are unsupported.
    }
    // Called by the adapter before executing `arm`: true when the stored last pose must be
    // erased from flash first. Once the coils energize, a reset could leave the mechanism
    // anywhere, so a hint from before this session must not survive in flash. Only an `arm`
    // that would succeed (authorized, referenced, released, not latched) clears it.
    bool prepareArm(const Packet &p) {
        uint32_t epoch = 0, seq = 0;
        const auto *op = p.get("op");
        const auto s = controller.state();
        if (!op || op->type != Field::Type::Text || op->text != "arm" ||
            !p.only({"op", "epoch", "seq"}) || !p.integer("epoch", epoch) ||
            !p.integer("seq", seq) || !controller.wouldAuthorize(epoch, seq) || s.armed ||
            !s.referenced || s.stopped || !lastPose.valid)
            return false;
        forgetPose();
        return true;
    }
    bool validPreset(const Preset &p) const {
        const auto c = controller.config();
        return std::isfinite(p.pan) && std::isfinite(p.tilt) && p.pan >= c.axis[0].minimum &&
               p.pan <= c.axis[0].maximum && p.tilt >= c.axis[1].minimum &&
               p.tilt <= c.axis[1].maximum;
    }
    bool validPose(const Pose &pose) const {
        Preset probe;
        probe.pan = pose.pan;
        probe.tilt = pose.tilt;
        return validPreset(probe);
    }

  private:
    // Optional per-move fields shared by move, relative, center and preset_move.
    static bool moveOptions(const Packet &p, double &speed, bool &retarget) {
        if (const auto *field = p.get("speed")) {
            if (field->type != Field::Type::Number)
                return false;
            speed = field->number;
        }
        if (const auto *field = p.get("retarget")) {
            if (field->type != Field::Type::Boolean)
                return false;
            retarget = field->number != 0;
        }
        return true;
    }
    // Optional preset name: absent leaves `present` false; anything unusable is invalid.
    static bool presetName(const Packet &p, std::string_view &name, bool &present) {
        const auto *field = p.get("name");
        present = field != nullptr;
        if (!field)
            return true;
        if (field->type != Field::Type::Text || !validPresetName(field->text))
            return false;
        name = field->text;
        return true;
    }
    // Releasing an armed session records where it rested, if the position is still trusted
    // (referenced and at rest; a STOP at rest keeps holding torque, so it still is). Releasing
    // motors that were not armed changes nothing, so a stored hint survives a reboot.
    void rememberPose() {
        const auto s = controller.state();
        if (!s.armed)
            return;
        Pose pose;
        if (s.referenced && !s.moving) {
            pose.pan = controller.position(0);
            pose.tilt = controller.position(1);
            pose.valid = true;
        }
        if (pose.valid != lastPose.valid || pose.pan != lastPose.pan ||
            pose.tilt != lastPose.tilt) {
            lastPose = pose;
            dirty = true;
        }
    }
    void forgetPose() {
        if (lastPose.valid) {
            lastPose = Pose{};
            dirty = true;
        }
    }
    // Presets can be recalled and edited at any time. Writes that need explicit coordinates
    // stay limited to released motors; saving the present pose or clearing a slot only
    // marks the settings dirty, and flash is written once the motors are released.
    Error preset(std::string_view name, const Packet &p, uint64_t now) {
        uint32_t slot = 0;
        if (!p.integer("slot", slot) || slot >= presets.size())
            return Error::Invalid;
        Preset &target = presets[slot];
        if (name == "preset_move") {
            double speed = 1;
            bool retarget = false;
            if (!p.only({"op", "epoch", "seq", "slot", "speed", "retarget"}) ||
                !moveOptions(p, speed, retarget) || !target.valid)
                return Error::Invalid;
            return controller.move(target.pan, target.tilt, false, now, speed, retarget);
        }
        if (name == "preset_clear") {
            if (!p.only({"op", "epoch", "seq", "slot"}))
                return Error::Invalid;
            if (target.valid) {
                target = Preset{};
                dirty = true;
            }
            return Error::Ok;
        }
        std::string_view label;
        bool named = false;
        if (name == "preset_set") {
            if (!p.only({"op", "epoch", "seq", "slot", "pan", "tilt", "name"}))
                return Error::Invalid;
            if (controller.state().armed)
                return Error::Busy;
            Preset next;
            if (!p.number("pan", next.pan) || !p.number("tilt", next.tilt) || !validPreset(next))
                return Error::Range;
            if (!presetName(p, label, named))
                return Error::Invalid;
            return store(target, next, label, named);
        }
        if (name == "preset_save") {
            if (!p.only({"op", "epoch", "seq", "slot", "name"}) || !presetName(p, label, named))
                return Error::Invalid;
            const auto s = controller.state();
            if (!s.referenced)
                return Error::NotReferenced;
            if (s.moving || s.jogging)
                return Error::Busy;
            Preset next;
            next.pan = controller.position(0);
            next.tilt = controller.position(1);
            return store(target, next, label, named);
        }
        return Error::Invalid;
    }
    // A name that is not supplied stays with the slot; a new slot starts unnamed.
    Error store(Preset &target, Preset next, std::string_view label, bool named) {
        next.valid = true;
        if (named)
            setPresetName(next, label);
        else if (target.valid)
            std::memcpy(next.name, target.name, sizeof(next.name));
        target = next;
        dirty = true;
        return Error::Ok;
    }
    Error motion(const Packet &p) {
        if (!p.only({"op", "epoch", "seq", "speed", "accel", "jerk"}))
            return Error::Invalid;
        auto scales = controller.scales();
        bool any = false;
        auto read = [&](const char *key, double &value) {
            const auto *field = p.get(key);
            if (!field)
                return true;
            if (field->type != Field::Type::Number)
                return false;
            value = field->number;
            any = true;
            return true;
        };
        if (!read("speed", scales.speed) || !read("accel", scales.accel) ||
            !read("jerk", scales.jerk) || !any)
            return Error::Invalid;
        return controller.setScales(scales);
    }
    Error settings(const Packet &p) {
        if (!p.only({"op", "epoch", "seq", "commissioned", "pan_steps", "tilt_steps", "pan_min",
                     "pan_max", "tilt_min", "tilt_max", "pan_speed", "tilt_speed", "pan_accel",
                     "tilt_accel", "pan_jerk", "tilt_jerk", "pan_inverted", "tilt_inverted"}))
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
            !number("tilt_accel", c.axis[1].acceleration) || !number("pan_jerk", c.axis[0].jerk) ||
            !number("tilt_jerk", c.axis[1].jerk) || !boolean("pan_inverted", c.axis[0].inverted) ||
            !boolean("tilt_inverted", c.axis[1].inverted) ||
            !boolean("commissioned", c.commissioned))
            return Error::Invalid;
        auto result = controller.configure(c);
        if (result == Error::Ok) {
            for (auto &preset : presets)
                if (preset.valid && !validPreset(preset))
                    preset = Preset{};
            if (lastPose.valid && !validPose(lastPose))
                lastPose = Pose{};
            dirty = true;
        }
        return result;
    }
};
} // namespace camx
