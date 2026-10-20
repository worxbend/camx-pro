#include "camx/http.hpp"
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
camx::HttpRequest feed(const std::string &raw) {
    camx::HttpRequest r;
    for (char c : raw)
        r.feed(c);
    return r;
}
int main() {
    const std::string head = "POST /api/command HTTP/1.1\r\nHost: device\r\nContent-Type: "
                             "application/json\r\nAuthorization: Bearer secret\r\nContent-Length: ";
    const std::string body = "{\"op\":\"stop\"}";
    camx::HttpRequest r;
    for (char c : head + std::to_string(body.size()) + "\r\n\r\n" + body)
        CHECK(r.feed(c) != camx::HttpRequest::Result::Invalid);
    CHECK(r.complete() && r.body() == body && r.authenticated("secret"));
    CHECK(!r.authenticated("secre") && !r.authenticated(""));
    CHECK(!feed(head + "999999\r\n\r\n").valid());
    CHECK(!feed(head + "13\r\nContent-Length: 13\r\n\r\n" + body).valid());
    CHECK(!feed(head + "13\r\nTransfer-Encoding: chunked\r\n\r\n" + body).valid());
    CHECK(!feed("GET /api/state HTTP/1.1\r\nX:" + std::string(1800, 'a') + "\r\n\r\n").valid());
    CHECK(!feed(head + "13\r\n\r\n" + body.substr(0, 5)).complete());
    CHECK(!feed(head + "13\r\nAuthorization: Bearer other\r\n\r\n" + body).valid());
    CHECK(!feed(head + "+13\r\n\r\n" + body).valid());
    CHECK(!feed(head + "13\r\n folded: nope\r\n\r\n" + body).valid());
    std::mt19937 random(99);
    const auto seed = head + "13\r\n\r\n" + body;
    for (int i = 0; i < 30000; ++i) {
        auto input = seed;
        for (unsigned m = 0, n = 1 + random() % 8; m < n; ++m)
            input[random() % input.size()] = static_cast<char>(random() % 256);
        auto parsed = feed(input);
        if (parsed.complete()) {
            (void)parsed.body();
            (void)parsed.path();
            (void)parsed.authenticated("secret");
        }
    }
    std::cout << "bounded fragmented HTTP and authentication: PASS\n";
}
