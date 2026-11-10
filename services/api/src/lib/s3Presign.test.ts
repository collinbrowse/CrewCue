import test from "node:test";
import assert from "node:assert/strict";
import { presignS3Url } from "./s3Presign.js";

// AWS's published SigV4 presigned GET example (s3 "query string auth" docs).
test("presignS3Url matches the AWS documented example signature", () => {
  const url = presignS3Url(
    {
      endpoint: "https://s3.amazonaws.com",
      bucket: "examplebucket",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      urlStyle: "virtual"
    },
    "GET",
    "test.txt",
    86400,
    new Date("2013-05-24T00:00:00Z")
  );
  assert.ok(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?"));
  assert.ok(
    url.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"),
    url
  );
});

test("presignS3Url path style keeps the bucket in the path", () => {
  const url = presignS3Url(
    {
      endpoint: "http://localhost:9000",
      bucket: "photos",
      region: "auto",
      accessKeyId: "a",
      secretAccessKey: "b",
      urlStyle: "path"
    },
    "PUT",
    "rooms/r1/u/x.jpg",
    60
  );
  assert.ok(url.startsWith("http://localhost:9000/photos/rooms/r1/u/x.jpg?"));
});
