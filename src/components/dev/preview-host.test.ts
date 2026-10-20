import { describe, expect, it } from "bun:test";
import { isDevToolsHost } from "./preview-host";

describe("DEV tools hostname gate", () => {
  it("shows the switcher on the Org Admin draft preview", () => {
    expect(isDevToolsHost("id-preview-10--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app")).toBe(true);
  });

  it("keeps the main preview and local development enabled", () => {
    expect(isDevToolsHost("id-preview--d9b69d11-663e-4423-8783-c75a42c0e56f.lovable.app")).toBe(true);
    expect(isDevToolsHost("gradus.lovableproject.com")).toBe(true);
    expect(isDevToolsHost("localhost")).toBe(true);
    expect(isDevToolsHost("127.0.0.1")).toBe(true);
  });

  it("does not expose the switcher on published domains", () => {
    expect(isDevToolsHost("gradus.training")).toBe(false);
    expect(isDevToolsHost("gradustraining.lovable.app")).toBe(false);
    expect(isDevToolsHost("id-preview-10--project.lovable.app.example.com")).toBe(false);
  });
});