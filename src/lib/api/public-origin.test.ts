import { describe, expect, it } from "bun:test";
import { publicOrigin } from "./public-origin";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("publicOrigin", () => {
  it("is the server's own address with no proxy in front", () => {
    expect(publicOrigin(req("http://localhost:8082/api/v1/x"))).toBe("http://localhost:8082");
    expect(publicOrigin(req("https://gradus.training/api/v1/x"))).toBe("https://gradus.training");
  });

  it("is the tunnel's address when a dev tunnel forwards to localhost", () => {
    const tunneled = req("http://localhost:8080/api/v1/x", {
      "x-forwarded-host": "46nm71n3-8080.inc1.devtunnels.ms",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(tunneled)).toBe("https://46nm71n3-8080.inc1.devtunnels.ms");
  });

  it("never takes a forwarded host on a deployed site, or a malformed one", () => {
    expect(
      publicOrigin(req("https://gradus.training/x", { "x-forwarded-host": "evil.example" })),
    ).toBe("https://gradus.training");
    expect(
      publicOrigin(req("http://localhost:8080/x", { "x-forwarded-host": "evil.example/path?a" })),
    ).toBe("http://localhost:8080");
  });
});
