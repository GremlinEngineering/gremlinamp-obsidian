#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>

#include "ao.h"
#include "psx.h"
#include "peops2/spu.h"

bool stop_flag = false;

Index<char> ao_get_lib(char *name) {
    std::ifstream file(name, std::ios::binary);
    return Index<char>(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

static int16_t audio[735 * 2];
static unsigned step = 0;

static void receive_audio(const void *samples, int bytes) {
    const auto *source = static_cast<const int16_t *>(samples);
    std::copy_n(source, std::min<int>(bytes / sizeof(int16_t), std::size(audio)), audio);
}

extern "C" int gremlin_psf2_open(uint8_t *bytes, uint32_t size) {
    if (size < 16 || bytes[0] != 'P' || bytes[1] != 'S' || bytes[2] != 'F' || bytes[3] != 2)
        return 0;
    stop_flag = false;
    step = 0;
    const int result = psf2_start(bytes, size);
    if (result == AO_SUCCESS) setendless2(1);
    return result == AO_SUCCESS;
}

extern "C" const int16_t *gremlin_psf2_render() {
    std::fill(std::begin(audio), std::end(audio), 0);
    for (unsigned i = 0; i < 735; ++i) {
        SPU2async(receive_audio);
        ps2_hw_slice();
        if (++step == 735) {
            ps2_hw_frame();
            step = 0;
        }
    }
    return audio;
}
