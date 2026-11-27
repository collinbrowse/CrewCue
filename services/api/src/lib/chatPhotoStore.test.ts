import test from "node:test";
import assert from "node:assert/strict";
import { detectChatPhotoContentType } from "./chatPhotoStore.js";

const ascii = (s: string) => Buffer.from(s, "latin1");

test("detectChatPhotoContentType reads JPEG, PNG, WebP and HEIC from their first bytes", () => {
  assert.equal(detectChatPhotoContentType(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0])), "image/jpeg");
  assert.equal(
    detectChatPhotoContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    "image/png"
  );
  assert.equal(detectChatPhotoContentType(Buffer.concat([ascii("RIFF"), Buffer.alloc(4), ascii("WEBPVP8 ")])), "image/webp");
  for (const brand of ["heic", "heix", "mif1"]) {
    const heif = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii("ftyp"), ascii(brand), Buffer.alloc(8)]);
    assert.equal(detectChatPhotoContentType(heif), "image/heic", brand);
  }
});

test("detectChatPhotoContentType refuses anything else", () => {
  for (const bytes of [
    ascii("<html><body>hi</body></html>"),
    ascii("GIF89a......"),
    ascii("%PDF-1.7\n"),
    Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii("ftypmp42"), Buffer.alloc(8)]),
    Buffer.concat([ascii("RIFF"), Buffer.alloc(4), ascii("WAVE")]),
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(0)
  ]) {
    assert.equal(detectChatPhotoContentType(bytes), undefined, bytes.toString("latin1"));
  }
});
