#!/bin/bash
# 生成一张合法的测试 PNG（真彩色、无压缩），用于线上素材上传自测。
# 用 zlib + struct 手写 PNG 结构，不依赖 Pillow。
python3 - <<'PY'
import struct, zlib, sys

def chunk(tag, data):
    c = tag + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

W = H = 12
raw = bytearray()
for y in range(H):
    raw.append(0)  # filter type 0
    for x in range(W):
        raw += bytes((0xF4, 0xA1, 0x5B))

png = (
    b'\x89PNG\r\n\x1a\n'
    + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
    + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    + chunk(b'IEND', b'')
)
with open('/tmp/e2e.png', 'wb') as f:
    f.write(png)
print('wrote /tmp/e2e.png', len(png), 'bytes')
PY
