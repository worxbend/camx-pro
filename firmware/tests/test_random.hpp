// Deterministic SplitMix64 generator for reproducible host tests. It only spreads test
// inputs; a fixed seed makes every run identical. Not for anything security-related.
#pragma once
#include <cstdint>
#include <limits>

class TestRandom {
  public:
    using result_type = uint32_t;
    explicit TestRandom(uint64_t seed) : state_(seed) {}
    static constexpr result_type min() { return 0; }
    static constexpr result_type max() { return std::numeric_limits<result_type>::max(); }
    result_type operator()() {
        uint64_t z = state_ += 0x9e3779b97f4a7c15ull;
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
        return static_cast<result_type>((z ^ (z >> 31)) >> 32);
    }

  private:
    uint64_t state_;
};
