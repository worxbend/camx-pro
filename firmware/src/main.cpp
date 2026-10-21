#include "board.hpp"
#include "camx/http.hpp"
#include "camx/status.hpp"
#include "camx/storage.hpp"
#include "web_ui.hpp"
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <cerrno>
#include <driver/gpio.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <lwip/sockets.h>
#include <soc/gpio_struct.h>
#if !defined(CAMX_PUBLIC_BUILD) && __has_include("credentials.h")
#include "credentials.h"
#else
#include "credentials.example.h"
#endif

namespace {
camx::Device device(1);
// Copy of `device` for serialization and flash writes. Only the loop task touches it, and
// keeping it off the stack leaves that task's stack for the HTTP and JSON work.
camx::Device scratch(1);
SemaphoreHandle_t motorMutex = nullptr;
esp_timer_handle_t motorTimer = nullptr;
Preferences preferences;
bool storageOk = true, nvsOpen = false, provisioned = false;
WiFiServer server(80);
WiFiClient client;
camx::HttpRequest request;
char statusBody[4096]{};
char serialOutput[4096]{};
size_t serialSent = 0, serialSize = 0;
char responseHeader[384]{};
const char *response = nullptr;
size_t responseSize = 0, headerSize = 0, sent = 0;
uint64_t clientAt = 0;
char serialLine[769]{};
size_t serialLength = 0;
bool serialOverflow = false;
uint8_t applied[2] = {0, 0};
bool physicalStopWasOpen = false;

uint64_t nowUs() {
    return static_cast<uint64_t>(esp_timer_get_time());
}

void applyCoils() {
    // Only called under motorMutex, or in setup before timer creation.
    for (unsigned axis = 0; axis < 2; ++axis) {
        uint8_t mask = device.controller.coils(axis);
        if (mask == applied[axis])
            continue;
        uint32_t high = 0, low = 0;
        for (unsigned i = 0; i < 4; ++i) {
            if (mask & (1u << i))
                high |= 1u << board::coils[axis][i];
            else
                low |= 1u << board::coils[axis][i];
        }
        GPIO.out_w1tc = low;
        GPIO.out_w1ts = high;
        applied[axis] = mask;
    }
}

void motorTick(void *) {
    // ESP_TIMER_TASK callback, not ISR. No allocation, I/O, logging or flash writes.
    if (xSemaphoreTake(motorMutex, 0) != pdTRUE)
        return;
    const uint64_t began = nowUs();
    if constexpr (board::stopPin >= 0) {
        bool open = gpio_get_level(static_cast<gpio_num_t>(board::stopPin)) != 0;
        if (open && !physicalStopWasOpen)
            device.controller.stop();
        physicalStopWasOpen = open;
    }
    device.controller.tick(began);
    applyCoils();
    device.controller.noteTickCost(nowUs() - began);
    xSemaphoreGive(motorMutex);
}

void snapshot(camx::Device &copy) {
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    copy = device;
    xSemaphoreGive(motorMutex);
}

// Writes the settings blob. Only the loop task calls this, and only with the motors released;
// the timer cannot arm the device.
bool persistSettings() {
    snapshot(scratch);
    const auto blob = camx::encodeSettings(scratch);
    storageOk =
        nvsOpen && preferences.putBytes("settings", blob.data(), blob.size()) == blob.size();
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    if (storageOk)
        device.dirty = false;
    xSemaphoreGive(motorMutex);
    return storageOk;
}

camx::Error execute(std::string_view body) {
    camx::Packet packet;
    if (!camx::parsePacket(body, packet))
        return camx::Error::Invalid;
    xSemaphoreTake(motorMutex, portMAX_DELAY);
    camx::Error result;
    const auto *op = packet.get("op");
    const bool blocked = board::stopPin >= 0 && physicalStopWasOpen && op && op->text != "stop" &&
                         op->text != "disarm" && op->text != "state";
    // Erase the last-pose hint from flash while the coils are still off (Device::prepareArm).
    // A failed write is reported through storage_ok; arming still proceeds.
    if (!blocked && device.prepareArm(packet)) {
        xSemaphoreGive(motorMutex);
        persistSettings();
        xSemaphoreTake(motorMutex, portMAX_DELAY);
    }
    if (blocked)
        result = camx::Error::Stopped;
    else
        result = device.execute(packet, nowUs());
    applyCoils();
    bool persist = result == camx::Error::Ok && device.dirty && !device.controller.state().armed;
    xSemaphoreGive(motorMutex);
    if (persist && !persistSettings())
        result = camx::Error::Storage;
    return result;
}

size_t makeStatus(camx::Error result, char *buffer, size_t capacity) {
    snapshot(scratch);
    return camx::writeStatus(scratch, result, storageOk, buffer, capacity);
}

void respond(int code, const char *type, const char *body, size_t length) {
    response = body;
    responseSize = length;
    sent = 0;
    headerSize = static_cast<size_t>(
        snprintf(responseHeader, sizeof(responseHeader),
                 "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nConnection: "
                 "close\r\nCache-Control: no-store\r\nX-Content-Type-Options: "
                 "nosniff\r\nX-Frame-Options: DENY\r\n\r\n",
                 code, code == 200 ? "OK" : "Error", type, static_cast<unsigned>(length)));
    clientAt = nowUs();
}
void route() {
    if (!request.post() && request.path() == "/") {
        respond(200, "text/html; charset=utf-8", webUi, sizeof(webUi) - 1);
        return;
    }
    if (!request.authenticated(API_TOKEN)) {
        static constexpr char denied[] = "{\"error\":\"unauthorized\"}";
        respond(401, "application/json", denied, sizeof(denied) - 1);
        return;
    }
    if (!request.post() && request.path() == "/api/state") {
        auto n = makeStatus(camx::Error::Ok, statusBody, sizeof(statusBody));
        respond(200, "application/json", statusBody, n);
        return;
    }
    if (request.post() && request.path() == "/api/command") {
        auto result = execute(request.body());
        auto n = makeStatus(result, statusBody, sizeof(statusBody));
        respond(result == camx::Error::Ok                                        ? 200
                : result == camx::Error::Invalid || result == camx::Error::Range ? 400
                                                                                 : 409,
                "application/json", statusBody, n);
        return;
    }
    static constexpr char missing[] = "{\"error\":\"not_found\"}";
    respond(404, "application/json", missing, sizeof(missing) - 1);
}
void serviceHttp() {
    if (!provisioned)
        return;
    if (!client) {
        client = server.available();
        if (!client)
            return;
        client.setNoDelay(true);
        request = {};
        response = nullptr;
        clientAt = nowUs();
    }
    if (nowUs() - clientAt > (response ? 2000000u : 1000000u)) {
        client.stop();
        return;
    }
    if (response) {
        const char *bytes =
            sent < headerSize ? responseHeader + sent : response + sent - headerSize;
        size_t remaining = sent < headerSize ? headerSize - sent : headerSize + responseSize - sent;
        if (remaining == 0) {
            client.stop();
            return;
        }
        int n = ::send(client.fd(), bytes, std::min(remaining, size_t(512)), MSG_DONTWAIT);
        if (n > 0)
            sent += static_cast<size_t>(n);
        else if (n == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR))
            client.stop();
        return;
    }
    for (unsigned i = 0; i < 256 && client.available(); ++i) {
        auto result = request.feed(static_cast<char>(client.read()));
        if (result == camx::HttpRequest::Result::Invalid) {
            static constexpr char bad[] = "{\"error\":\"bad_request\"}";
            respond(400, "application/json", bad, sizeof(bad) - 1);
            return;
        }
        if (result == camx::HttpRequest::Result::Complete) {
            route();
            return;
        }
    }
}
void serviceSerial() {
    if (serialSent < serialSize) {
        const size_t count = std::min(serialSize - serialSent,
                                      static_cast<size_t>(std::max(0, Serial.availableForWrite())));
        if (count)
            serialSent +=
                Serial.write(reinterpret_cast<const uint8_t *>(serialOutput + serialSent), count);
        return;
    }
    for (unsigned i = 0; i < 128 && Serial.available(); ++i) {
        const char ch = static_cast<char>(Serial.read());
        if (ch == '\r')
            continue;
        if (ch == '\n') {
            auto result =
                serialOverflow ? camx::Error::Invalid : execute({serialLine, serialLength});
            const auto n = makeStatus(result, serialOutput, sizeof(serialOutput) - 1);
            serialOutput[n] = '\n';
            serialSize = n + 1;
            serialSent = 0;
            serialLength = 0;
            serialOverflow = false;
            return;
        } else if (serialLength < sizeof(serialLine) - 1)
            serialLine[serialLength++] = ch;
        else
            serialOverflow = true;
    }
}
} // namespace

void setup() {
    for (auto axis : board::coils)
        for (int pin : axis) {
            digitalWrite(pin, LOW);
            pinMode(pin, OUTPUT);
        }
    if constexpr (board::stopPin >= 0)
        pinMode(board::stopPin, INPUT_PULLUP);
    Serial.begin(115200);
    motorMutex = xSemaphoreCreateMutex();
    if (!motorMutex) {
        Serial.println("FATAL: motor mutex unavailable; outputs off");
        for (;;)
            delay(1000);
    }
    // Wi-Fi initialization enables the RF entropy source even for an unconfigured build.
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    device = camx::Device(esp_random());
    nvsOpen = preferences.begin("camx-pro-v1", false);
    storageOk = nvsOpen;
    if (nvsOpen && preferences.isKey("settings")) {
        // Accepts the current format and the shorter one written by firmware 1.0.0.
        camx::SettingsBlob blob{};
        const size_t stored = preferences.getBytesLength("settings");
        storageOk = stored > 0 && stored <= blob.size() &&
                    preferences.getBytes("settings", blob.data(), stored) == stored &&
                    camx::decodeSettings(blob.data(), stored, device);
        if (!storageOk)
            Serial.println("Settings invalid: reduced defaults loaded; position unreferenced");
    }
    esp_timer_create_args_t args{};
    args.callback = motorTick;
    args.dispatch_method = ESP_TIMER_TASK;
    args.name = "camx-step";
    args.skip_unhandled_events = true;
    if (esp_timer_create(&args, &motorTimer) != ESP_OK ||
        esp_timer_start_periodic(motorTimer, 250) != ESP_OK) {
        Serial.println("FATAL: timer unavailable; outputs off");
        for (;;)
            delay(1000);
    }
    provisioned = strlen(WIFI_SSID) > 0 && strlen(API_TOKEN) >= 16 && strlen(API_TOKEN) <= 96;
    for (char c : API_TOKEN)
        if (c && (c <= 32 || c >= 127))
            provisioned = false;
    if (provisioned) {
        WiFi.setHostname("camx-pro");
        WiFi.setAutoReconnect(true);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        server.begin();
    }
    Serial.println(
        "CAMX Pro 1.1.0; coils OFF; manual reference required. Serial JSON: {\"op\":\"state\"}");
    if (!provisioned)
        Serial.println(
            "Wi-Fi control disabled: configure ignored credentials.h (16–96 character token)");
}

void loop() {
    static bool connected = false;
    bool online = provisioned && WiFi.status() == WL_CONNECTED;
    if (online && !connected && serialSent == serialSize) {
        Serial.print("Control URL: http://");
        Serial.println(WiFi.localIP());
    }
    if (!online && connected) {
        xSemaphoreTake(motorMutex, portMAX_DELAY);
        device.controller.stop();
        applyCoils();
        xSemaphoreGive(motorMutex);
        client.stop();
    }
    connected = online;
    serviceSerial();
    serviceHttp();
    delay(1);
}
