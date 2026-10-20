#pragma once
#include <array>
#include <cstring>
#include <string_view>

namespace camx {
class HttpRequest {
  public:
    enum class Result { Pending, Complete, Invalid };
    Result feed(char byte) {
        if (!valid_ || complete() || used_ == bytes_.size()) {
            valid_ = false;
            return Result::Invalid;
        }
        if (byte == '\0') {
            valid_ = false;
            return Result::Invalid;
        }
        bytes_[used_++] = byte;
        if (!header_ && used_ >= 4 && std::memcmp(bytes_.data() + used_ - 4, "\r\n\r\n", 4) == 0) {
            header_ = used_;
            valid_ = parseHeaders();
        }
        if (!header_ && used_ >= 1536)
            valid_ = false;
        return !valid_ ? Result::Invalid : complete() ? Result::Complete : Result::Pending;
    }
    bool valid() const { return valid_; }
    bool complete() const { return valid_ && header_ && used_ == header_ + length_; }
    std::string_view body() const {
        return complete() ? std::string_view(bytes_.data() + header_, length_) : std::string_view{};
    }
    std::string_view path() const { return slice(pathAt_, pathSize_); }
    bool post() const { return post_; }
    bool authenticated(std::string_view token) const {
        auto supplied = slice(authAt_, authSize_);
        if (token.empty() || supplied.size() != token.size() + 7 ||
            supplied.substr(0, 7) != "Bearer ")
            return false;
        unsigned difference = 0;
        for (size_t i = 0; i < token.size(); ++i)
            difference |= static_cast<unsigned char>(token[i] ^ supplied[i + 7]);
        return difference == 0;
    }

  private:
    std::array<char, 2304> bytes_{};
    size_t used_ = 0, header_ = 0, length_ = 0;
    size_t pathAt_ = 0, pathSize_ = 0, authAt_ = 0, authSize_ = 0;
    bool valid_ = true, post_ = false;
    std::string_view slice(size_t at, size_t size) const { return {bytes_.data() + at, size}; }
    static bool equalFold(std::string_view a, std::string_view b) {
        if (a.size() != b.size())
            return false;
        for (size_t i = 0; i < a.size(); ++i) {
            char c = a[i];
            if (c >= 'A' && c <= 'Z')
                c += 'a' - 'A';
            if (c != b[i])
                return false;
        }
        return true;
    }
    bool parseHeaders() {
        const auto raw = slice(0, header_);
        const auto end = raw.find("\r\n");
        const auto line = raw.substr(0, end);
        const auto first = line.find(' '), last = line.rfind(' ');
        if (first == std::string_view::npos || last <= first)
            return false;
        if (line.substr(0, first) != "GET" && line.substr(0, first) != "POST")
            return false;
        post_ = line.substr(0, first) == "POST";
        pathAt_ = first + 1;
        pathSize_ = last - first - 1;
        if (path().empty() || path()[0] != '/' ||
            (line.substr(last + 1) != "HTTP/1.1" && line.substr(last + 1) != "HTTP/1.0"))
            return false;
        bool hasLength = false, hasType = false, hasAuth = false, hasHost = false;
        size_t at = end + 2;
        while (at < header_ - 2) {
            const auto stop = raw.find("\r\n", at);
            if (stop == std::string_view::npos)
                return false;
            auto entry = raw.substr(at, stop - at);
            const auto colon = entry.find(':');
            if (colon == 0 || colon == std::string_view::npos)
                return false;
            const auto key = entry.substr(0, colon);
            for (char c : key)
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-'))
                    return false;
            auto value = entry.substr(colon + 1);
            while (!value.empty() && (value.front() == ' ' || value.front() == '\t'))
                value.remove_prefix(1);
            while (!value.empty() && (value.back() == ' ' || value.back() == '\t'))
                value.remove_suffix(1);
            for (char c : value)
                if (static_cast<unsigned char>(c) < 32 || c == 127)
                    return false;
            if (equalFold(key, "transfer-encoding") || equalFold(key, "expect"))
                return false;
            if (equalFold(key, "host")) {
                if (hasHost || value.empty())
                    return false;
                hasHost = true;
            }
            if (equalFold(key, "authorization")) {
                if (hasAuth)
                    return false;
                hasAuth = true;
                authAt_ = static_cast<size_t>(value.data() - bytes_.data());
                authSize_ = value.size();
            }
            if (equalFold(key, "content-type")) {
                if (hasType || value != "application/json")
                    return false;
                hasType = true;
            }
            if (equalFold(key, "content-length")) {
                if (hasLength || value.empty() || value.size() > 4)
                    return false;
                hasLength = true;
                for (char c : value) {
                    if (c < '0' || c > '9')
                        return false;
                    length_ = length_ * 10 + static_cast<unsigned>(c - '0');
                }
                if (length_ > 768)
                    return false;
            }
            at = stop + 2;
        }
        return hasHost && (post_ ? hasLength && hasType && length_ > 0 : length_ == 0);
    }
};
} // namespace camx
