#include "camx/protocol.hpp"
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
    std::cout << "strict JSON, command dispatch, replay protection: PASS\n";
}
