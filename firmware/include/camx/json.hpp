#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <string_view>

namespace camx {
// Deliberately small flat JSON dialect: no nested objects, null, escape sequences,
// duplicate keys, unknown fields, non-finite values or silent coercion.
struct Field {
    std::string_view key{}, text{};
    enum class Type { Number, Boolean, Text } type = Type::Number;
    double number = 0;
};
struct Packet {
    std::array<Field, 24> fields{};
    size_t count = 0;
    const Field *get(std::string_view key) const {
        for (size_t i = 0; i < count; ++i)
            if (fields[i].key == key)
                return &fields[i];
        return nullptr;
    }
    bool number(std::string_view key, double &value) const {
        const auto *field = get(key);
        if (!field || field->type != Field::Type::Number)
            return false;
        value = field->number;
        return true;
    }
    bool integer(std::string_view key, uint32_t &value) const {
        double n = 0;
        if (!number(key, n) || n < 0 || n > UINT32_MAX || std::floor(n) != n)
            return false;
        value = static_cast<uint32_t>(n);
        return true;
    }
    bool only(std::initializer_list<std::string_view> keys) const {
        for (size_t i = 0; i < count; ++i) {
            bool found = false;
            for (auto key : keys)
                found |= fields[i].key == key;
            if (!found)
                return false;
        }
        return true;
    }
};

inline bool parsePacket(std::string_view input, Packet &out) {
    out = {};
    if (input.empty() || input.size() > 768)
        return false;
    size_t at = 0;
    auto space = [&] {
        while (at < input.size() &&
               (input[at] == ' ' || input[at] == '\t' || input[at] == '\r' || input[at] == '\n'))
            ++at;
    };
    auto consume = [&](char ch) {
        space();
        if (at >= input.size() || input[at] != ch)
            return false;
        ++at;
        return true;
    };
    auto string = [&](std::string_view &value) {
        if (!consume('"'))
            return false;
        size_t start = at;
        while (at < input.size() && input[at] != '"') {
            if (static_cast<unsigned char>(input[at]) < 32 || input[at] == '\\' || at - start >= 32)
                return false;
            ++at;
        }
        value = input.substr(start, at - start);
        return at < input.size() && input[at++] == '"';
    };
    auto digit = [&] { return at < input.size() && input[at] >= '0' && input[at] <= '9'; };
    if (!consume('{'))
        return false;
    space();
    if (at < input.size() && input[at] == '}') {
        ++at;
        space();
        return at == input.size();
    }
    for (;;) {
        if (out.count == out.fields.size())
            return false;
        Field f;
        if (!string(f.key) || out.get(f.key) || !consume(':'))
            return false;
        space();
        if (at == input.size())
            return false;
        if (input[at] == '"') {
            f.type = Field::Type::Text;
            if (!string(f.text))
                return false;
        } else if (input.substr(at, 4) == "true") {
            f.type = Field::Type::Boolean;
            f.number = 1;
            at += 4;
        } else if (input.substr(at, 5) == "false") {
            f.type = Field::Type::Boolean;
            at += 5;
        } else {
            size_t start = at;
            if (input[at] == '-')
                ++at;
            if (!digit())
                return false;
            if (input[at] == '0')
                ++at;
            else
                while (digit())
                    ++at;
            if (at < input.size() && input[at] == '.') {
                ++at;
                if (!digit())
                    return false;
                while (digit())
                    ++at;
            }
            if (at < input.size() && (input[at] == 'e' || input[at] == 'E')) {
                ++at;
                if (at < input.size() && (input[at] == '+' || input[at] == '-'))
                    ++at;
                if (!digit())
                    return false;
                while (digit())
                    ++at;
            }
            if (at - start >= 64)
                return false;
            char buffer[64]{};
            std::memcpy(buffer, input.data() + start, at - start);
            char *end = nullptr;
            f.number = std::strtod(buffer, &end);
            if (*end != '\0' || !std::isfinite(f.number))
                return false;
        }
        out.fields[out.count++] = f;
        space();
        if (at == input.size())
            return false;
        if (input[at] == '}') {
            ++at;
            space();
            return at == input.size();
        }
        if (!consume(','))
            return false;
    }
}
} // namespace camx
