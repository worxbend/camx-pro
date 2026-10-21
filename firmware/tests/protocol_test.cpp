#include "camx/status.hpp"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#define CHECK(c)                                                                                   \
    do {                                                                                           \
        if (!(c)) {                                                                                \
            std::cerr << __LINE__ << ": " #c "\n";                                                 \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (false)
int main() {
    camx::Packet p;
    CHECK(camx::parsePacket(R"({"op":"move","epoch":4,"seq":1,"pan":2.5,"tilt":-1})", p));
    CHECK(!camx::parsePacket(R"({"op":"move","pan":1,"pan":2})", p));
    CHECK(!camx::parsePacket(R"({"op":"move","pan":1e999})", p));
    CHECK(!camx::parsePacket(R"({"op":"move","pan":01})", p));
    CHECK(!camx::parsePacket(R"({"op":"move"} garbage)", p));
    camx::Device device(4);
    CHECK(device.execute(R"({"op":"reference","epoch":4,"seq":1,"pan":0,"tilt":0})", 0) ==
          camx::Error::Ok);
    CHECK(device.execute(R"({"op":"arm","epoch":5,"seq":1})", 0) == camx::Error::Ok);
    CHECK(device.execute(R"({"op":"relative","epoch":5,"seq":2,"pan":1,"tilt":0})", 0) ==
          camx::Error::Ok);
    CHECK(device.execute(R"({"op":"relative","epoch":5,"seq":2,"pan":1,"tilt":0})", 0) ==
          camx::Error::Stale);
    CHECK(device.execute(R"({"op":"stop"})", 1) == camx::Error::Ok);
    CHECK(device.controller.state().stopped);
    CHECK(!device.controller.state().referenced);
    CHECK(device.execute(R"({"op":"home","epoch":6,"seq":1})", 2) == camx::Error::Invalid);
    for (const auto *invalid :
         {R"({"op":"arm",})", R"({"op":"arm","seq":+1})", R"({"op":"arm","seq":1.})",
          R"({"op":"arm","seq":null})", R"({"op":"arm","seq":[]})", R"({"op":"arm","seq":{}})",
          R"({"op":"arm","seq":1e})", R"({"op":"ar\u006d"})"})
        CHECK(!camx::parsePacket(invalid, p));
    camx::Device settings(100);
    CHECK(settings.execute(
              R"({"op":"settings","epoch":100,"seq":1,"pan_inverted":true,"pan_speed":2.5})", 0) ==
          camx::Error::Ok);
    CHECK(settings.controller.config().axis[0].inverted && settings.dirty);
    CHECK(settings.execute(R"({"op":"settings","epoch":101,"seq":1,"pan_inverted":1})", 0) ==
          camx::Error::Invalid);
    CHECK(settings.execute(R"({"op":"preset_set","epoch":101,"seq":2,"slot":0,"pan":1,"tilt":-1})",
                           0) == camx::Error::Ok);
    CHECK(settings.execute(R"({"op":"reference","epoch":101,"seq":3,"pan":0,"tilt":0})", 0) ==
          camx::Error::Ok);
    CHECK(settings.execute(R"({"op":"arm","epoch":102,"seq":1})", 0) == camx::Error::Ok);
    CHECK(settings.execute(R"({"op":"settings","epoch":102,"seq":2,"pan_speed":1})", 0) ==
          camx::Error::Busy);
    CHECK(settings.execute(R"({"op":"preset_set","epoch":102,"seq":3,"slot":1,"pan":0,"tilt":0})",
                           0) == camx::Error::Busy);
    CHECK(settings.execute(R"({"op":"preset_move","epoch":102,"seq":4,"slot":0})", 0) ==
          camx::Error::Ok);
    CHECK(settings.execute(R"({"op":"move","epoch":102,"seq":5,"pan":0,"tilt":0,"extra":1})", 0) ==
          camx::Error::Invalid);

    // Commands are built against the device's current epoch and sequence.
    auto send = [](camx::Device &dev, const std::string &fields, uint64_t now = 0) {
        const auto s = dev.controller.state();
        return dev.execute("{" + fields + ",\"epoch\":" + std::to_string(s.epoch) +
                               ",\"seq\":" + std::to_string(s.sequence + 1) + "}",
                           now);
    };
    // Runs the timer, sending the heartbeat an active controller owes the watchdog.
    auto advance = [&send](camx::Device &dev, uint64_t &now, double seconds) {
        uint64_t beat = now;
        for (const uint64_t until = now + uint64_t(seconds * 1e6); now < until;) {
            dev.controller.tick(now += 250);
            if (now - beat >= 1000000 && dev.controller.state().armed &&
                !dev.controller.state().stopped) {
                CHECK(send(dev, R"("op":"heartbeat")", now) == camx::Error::Ok);
                beat = now;
            }
        }
    };
    auto bring_up = [&](camx::Device &dev) {
        CHECK(send(dev, R"("op":"reference","pan":0,"tilt":0)") == camx::Error::Ok);
        CHECK(send(dev, R"("op":"arm")") == camx::Error::Ok);
    };

    // Runtime speed, acceleration and jerk scales.
    {
        camx::Device d(500);
        CHECK(send(d, R"("op":"motion","speed":0.5)") == camx::Error::Ok);
        CHECK(d.controller.scales().speed == 0.5 && d.controller.scales().accel == 1);
        CHECK(send(d, R"("op":"motion","accel":0.2,"jerk":0.3)") == camx::Error::Ok);
        CHECK(d.controller.scales().speed == 0.5 && d.controller.scales().accel == 0.2 &&
              d.controller.scales().jerk == 0.3);
        CHECK(!d.dirty); // runtime only: never written to flash
        CHECK(send(d, R"("op":"motion")") == camx::Error::Invalid);
        CHECK(send(d, R"("op":"motion","speed":0)") == camx::Error::Range);
        CHECK(send(d, R"("op":"motion","speed":1.5)") == camx::Error::Range);
        CHECK(send(d, R"("op":"motion","speed":true)") == camx::Error::Invalid);
        CHECK(send(d, R"("op":"motion","speed":"fast")") == camx::Error::Invalid);
        CHECK(send(d, R"("op":"motion","velocity":0.5)") == camx::Error::Invalid);
        CHECK(d.controller.scales().speed == 0.5 && d.controller.scales().jerk == 0.3);
        bring_up(d);
        CHECK(send(d, R"("op":"motion","speed":1)") == camx::Error::Ok); // allowed while armed
    }

    // Per-move speed and retargeting.
    {
        camx::Device d(600);
        uint64_t now = 0;
        bring_up(d);
        CHECK(send(d, R"("op":"move","pan":10,"tilt":0,"speed":2)", now) == camx::Error::Range);
        CHECK(send(d, R"("op":"move","pan":10,"tilt":0,"speed":"x")", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"move","pan":10,"tilt":0,"retarget":1)", now) ==
              camx::Error::Invalid);
        CHECK(send(d, R"("op":"move","pan":10,"tilt":0,"speed":0.5)", now) == camx::Error::Ok);
        advance(d, now, 0.5);
        CHECK(send(d, R"("op":"move","pan":-5,"tilt":0)", now) == camx::Error::Busy);
        CHECK(send(d, R"("op":"center")", now) == camx::Error::Busy);
        CHECK(send(d, R"("op":"move","pan":-5,"tilt":0,"retarget":false)", now) ==
              camx::Error::Busy);
        CHECK(send(d, R"("op":"move","pan":-5,"tilt":0,"retarget":true,"speed":1)", now) ==
              camx::Error::Ok);
        CHECK(d.controller.state().queued);
        CHECK(send(d, R"("op":"center","retarget":true,"speed":0.25)", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"jog","pan":1,"tilt":0,"speed":0.5)", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"reference","pan":1,"tilt":0,"retarget":true)", now) ==
              camx::Error::Invalid);
        advance(d, now, 30);
        CHECK(!d.controller.state().moving && !d.controller.state().stopped);
        CHECK(d.controller.state().steps[0] == 0 && d.controller.state().steps[1] == 0);
    }

    // Presets: names, saving the present pose, clearing, and deferred persistence.
    {
        camx::Device d(700);
        uint64_t now = 0;
        CHECK(send(d, R"("op":"preset_save","slot":0)") == camx::Error::NotReferenced);
        CHECK(send(d, R"("op":"preset_set","slot":1,"pan":3,"tilt":-2,"name":"Desk")") ==
              camx::Error::Ok);
        CHECK(std::string(d.presets[1].name) == "Desk" && d.presets[1].valid && d.dirty);
        CHECK(send(d, R"("op":"preset_set","slot":1,"pan":4,"tilt":-2)") == camx::Error::Ok);
        CHECK(std::string(d.presets[1].name) == "Desk" && d.presets[1].pan == 4); // name kept
        CHECK(send(d, R"("op":"preset_set","slot":1,"pan":4,"tilt":-2,"name":"")") ==
              camx::Error::Ok);
        CHECK(d.presets[1].name[0] == 0);
        CHECK(send(d, R"("op":"preset_set","slot":2,"pan":1,"tilt":1,"name":"ABCDEFGHIJKLMNOP")") ==
              camx::Error::Ok);
        CHECK(std::string(d.presets[2].name) == "ABCDEFGHIJKLMNOP");
        for (const char *bad :
             {R"("op":"preset_set","slot":3,"pan":1,"tilt":1,"name":"ABCDEFGHIJKLMNOPQ")",
              "\"op\":\"preset_set\",\"slot\":3,\"pan\":1,\"tilt\":1,\"name\":\"caf\xC3\xA9\"",
              R"("op":"preset_set","slot":3,"pan":1,"tilt":1,"name":7)",
              R"("op":"preset_set","slot":3,"pan":1,"tilt":1,"name":true)"})
            CHECK(send(d, bad) == camx::Error::Invalid);
        CHECK(!d.presets[3].valid && d.presets[3].name[0] == 0);

        d.dirty = false;
        bring_up(d);
        CHECK(send(d, R"("op":"move","pan":6.5,"tilt":-4.5)", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"preset_save","slot":4)", now) == camx::Error::Busy); // moving
        advance(d, now, 4);
        CHECK(send(d, R"("op":"preset_save","slot":4,"name":"Wide")", now) == camx::Error::Ok);
        CHECK(d.presets[4].valid && std::string(d.presets[4].name) == "Wide");
        CHECK(std::abs(d.presets[4].pan - 6.5) < 0.02 && std::abs(d.presets[4].tilt + 4.5) < 0.04);
        CHECK(d.validPreset(d.presets[4]));
        CHECK(d.dirty); // the flash write waits for the motors to be released
        CHECK(send(d, R"("op":"preset_save","slot":4,"pan":1)", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"preset_save","slot":8)", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"preset_clear","slot":2)", now) == camx::Error::Ok);
        CHECK(!d.presets[2].valid && d.presets[2].name[0] == 0 && d.presets[2].pan == 0);
        CHECK(send(d, R"("op":"preset_clear","slot":2)", now) == camx::Error::Ok); // idempotent
        CHECK(send(d, R"("op":"preset_clear","slot":2,"name":"x")", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"preset_clear","slot":9)", now) == camx::Error::Invalid);
        CHECK(send(d, R"("op":"preset_move","slot":2)", now) == camx::Error::Invalid); // empty
        CHECK(send(d, R"("op":"preset_set","slot":5,"pan":1,"tilt":1)", now) == camx::Error::Busy);
        CHECK(send(d, R"("op":"preset_move","slot":1,"speed":0.5)", now) == camx::Error::Ok);
        advance(d, now, 10);
        CHECK(d.controller.state().steps[0] == d.controller.config().axis[0].quantize(4));
    }

    // The last resting pose is remembered at release, but only when it can be trusted.
    {
        camx::Device d(800);
        uint64_t now = 0;
        CHECK(!d.lastPose.valid);
        bring_up(d);
        CHECK(send(d, R"("op":"move","pan":7,"tilt":-3)", now) == camx::Error::Ok);
        advance(d, now, 5);
        d.dirty = false;
        CHECK(send(d, R"("op":"disarm")", now) == camx::Error::Ok);
        CHECK(d.lastPose.valid && std::abs(d.lastPose.pan - 7) < 0.02 &&
              std::abs(d.lastPose.tilt + 3) < 0.04);
        CHECK(d.dirty && d.lastPose.valid);
        // A release that interrupts a move, or follows a STOP during one, remembers nothing.
        bring_up(d);
        CHECK(send(d, R"("op":"move","pan":-7,"tilt":0)", now) == camx::Error::Ok);
        advance(d, now, 1);
        CHECK(send(d, R"("op":"disarm")", now) == camx::Error::Ok);
        CHECK(!d.lastPose.valid);
        CHECK(send(d, R"("op":"reference","pan":2,"tilt":2)", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"arm")", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"move","pan":9,"tilt":2)", now) == camx::Error::Ok);
        advance(d, now, 1);
        CHECK(d.execute(R"({"op":"stop"})", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"disarm")", now) == camx::Error::Ok);
        CHECK(!d.lastPose.valid);
        // Narrowing the limits drops a pose that falls outside them.
        CHECK(send(d, R"("op":"reference","pan":10,"tilt":0)", now) == camx::Error::Ok);
        CHECK(send(d, R"("op":"disarm")", now) == camx::Error::Ok);
        CHECK(d.lastPose.valid && std::abs(d.lastPose.pan - 10) < 0.02); // quantized to a step
        CHECK(send(d, R"("op":"settings","pan_max":5)", now) == camx::Error::Ok);
        CHECK(!d.lastPose.valid);
    }

    // Jerk is a persistent setting with the same commissioning rule as speed and acceleration.
    {
        camx::Device d(900);
        CHECK(d.controller.config().axis[0].jerk == 80);
        CHECK(send(d, R"("op":"settings","pan_jerk":40,"tilt_jerk":20)") == camx::Error::Ok);
        CHECK(d.controller.config().axis[0].jerk == 40 && d.controller.config().axis[1].jerk == 20);
        CHECK(send(d, R"("op":"settings","pan_jerk":200)") == camx::Error::Invalid);
        CHECK(send(d, R"("op":"settings","pan_jerk":0.5)") == camx::Error::Invalid);
        CHECK(send(d, R"("op":"settings","tilt_jerk":"high")") == camx::Error::Invalid);
        CHECK(d.controller.config().axis[0].jerk == 40);
        CHECK(send(d, R"("op":"settings","commissioned":true,"pan_jerk":200)") == camx::Error::Ok);
        CHECK(d.controller.config().axis[0].jerk == 200);
        CHECK(send(d, R"("op":"settings","pan_jerk":501)") == camx::Error::Invalid);
    }

    // The status document stays valid JSON and fits its buffer in the worst case.
    {
        camx::Device d(1000);
        for (size_t i = 0; i < d.presets.size(); ++i) {
            d.presets[i] = {double(i) - 4, -double(i), true};
            camx::setPresetName(d.presets[i], "~ !#$%&'()*+,-./09~");
        }
        d.lastPose = {-19.999999, 14.999999, true};
        char out[4096]{};
        const size_t size = camx::writeStatus(d, camx::Error::Storage, true, out, sizeof(out));
        CHECK(size > 1000 && size < 2500);
        const std::string json(out, size);
        int braces = 0, brackets = 0;
        bool quoted = false;
        for (char c : json) {
            CHECK(static_cast<unsigned char>(c) >= 0x20);
            quoted ^= c == '"';
            if (!quoted)
                braces += (c == '{') - (c == '}'), brackets += (c == '[') - (c == ']');
            CHECK(braces >= 0 && brackets >= 0);
        }
        CHECK(!quoted && braces == 0 && brackets == 0);
        for (const char *key : {"\"api\":1", "\"api_minor\":1", "\"queued\":false", "\"eta\":0.000",
                                "\"motion\":{\"speed\":1.000000", "\"max_tick_cost_us\":0",
                                "\"last_pose\":{\"valid\":true", "\"jerk\":80.000000",
                                "\"accel_now\":0.000000", "\"name\":\"~ !#$%&'()*+,-./09~\""})
            CHECK(json.find(key) != std::string::npos);
        char tiny[200]{};
        CHECK(camx::writeStatus(d, camx::Error::Ok, true, tiny, sizeof(tiny)) ==
              0); // never truncates
    }

    // Mutated commands are executed, not just parsed: no crash, no UB, and invariants hold.
    {
        const std::string seeds[] = {
            R"({"op":"move","pan":2.5,"tilt":-1,"speed":0.5,"retarget":true,"epoch":%E,"seq":%S})",
            R"({"op":"preset_save","slot":3,"name":"Desk","epoch":%E,"seq":%S})",
            R"({"op":"preset_set","slot":2,"pan":1,"tilt":1,"name":"Wide","epoch":%E,"seq":%S})",
            R"({"op":"motion","speed":0.5,"accel":0.5,"jerk":0.5,"epoch":%E,"seq":%S})",
            R"({"op":"settings","pan_jerk":40,"pan_speed":2,"epoch":%E,"seq":%S})",
            R"({"op":"jog","pan":0.5,"tilt":-1,"epoch":%E,"seq":%S})",
            R"({"op":"preset_clear","slot":2,"epoch":%E,"seq":%S})"};
        std::mt19937 chaos(99);
        camx::Device d(1100);
        uint64_t now = 0;
        bring_up(d);
        for (int i = 0; i < 60000; ++i) {
            if (i % 2000 == 0) {
                d = camx::Device(1100 + i);
                now = 0;
                bring_up(d);
            }
            auto text = seeds[chaos() % 7];
            const auto s = d.controller.state();
            for (const char *tag : {"%E", "%S"}) {
                const auto at = text.find(tag);
                text.replace(at, 2, std::to_string(tag[1] == 'E' ? s.epoch : s.sequence + 1));
            }
            if (chaos() % 3)
                for (unsigned mutation = 0, count = 1 + chaos() % 3; mutation < count; ++mutation)
                    text[chaos() % text.size()] = static_cast<char>(chaos() % 256);
            (void)d.execute(text, now);
            advance(d, now, 0.01);
            const auto after = d.controller.state();
            CHECK(after.scales.speed >= 0.05 && after.scales.speed <= 1);
            CHECK(after.scales.accel >= 0.05 && after.scales.accel <= 1);
            CHECK(after.scales.jerk >= 0.05 && after.scales.jerk <= 1);
            CHECK(camx::validConfig(d.controller.config()));
            for (const auto &preset : d.presets) {
                CHECK(preset.name[camx::presetNameCapacity] == 0);
                CHECK(camx::validPresetName(preset.name));
                CHECK(!preset.valid ? preset.name[0] == 0 : d.validPreset(preset));
            }
            CHECK(!d.lastPose.valid || d.validPose(d.lastPose));
            for (unsigned a = 0; a < 2; ++a) {
                const auto &axis = d.controller.axis(a);
                const auto limits = d.controller.config().axis[a];
                CHECK(axis.steps >= limits.lowStep() && axis.steps <= limits.highStep());
            }
        }
    }

    std::mt19937 random(73);
    const std::string seed = R"({"op":"move","epoch":4,"seq":1,"pan":2.5,"tilt":-1})";
    for (int i = 0; i < 50000; ++i) {
        auto input = seed;
        for (unsigned mutation = 0, count = 1 + random() % 8; mutation < count; ++mutation) {
            input[random() % input.size()] = static_cast<char>(random() % 256);
        }
        if (i % 3 == 0)
            input.resize(random() % (input.size() + 1));
        (void)camx::parsePacket(input, p);
    }
    std::cout << "strict JSON, command dispatch, replay protection, new operations, status: PASS\n";
}
