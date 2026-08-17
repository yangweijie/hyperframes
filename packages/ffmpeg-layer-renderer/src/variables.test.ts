import { describe, expect, it } from "vitest";
import { substituteVariables } from "./variables.js";

describe("substituteVariables", () => {
  it("replaces __UPPER__ placeholders with matching values", () => {
    const html = `data-duration="__VIDEO_DURATION__" src="__VIDEO_SRC__"`;
    const out = substituteVariables(html, {
      __VIDEO_DURATION__: "10.24",
      __VIDEO_SRC__: "a-roll.mp4",
    });
    expect(out).toBe(`data-duration="10.24" src="a-roll.mp4"`);
  });

  it("leaves unknown placeholders untouched", () => {
    const html = `data-duration="__VIDEO_DURATION__"`;
    const out = substituteVariables(html, { __OTHER__: "x" });
    expect(out).toBe(html);
  });

  it("replaces {{token}} shape", () => {
    expect(substituteVariables("{{title}}", { title: "Hello" })).toBe("Hello");
  });

  it("replaces <<token>> shape", () => {
    expect(substituteVariables("<<title>>", { title: "Hello" })).toBe("Hello");
  });

  it("replaces ${token} shape", () => {
    expect(substituteVariables("${title}", { title: "Hello" })).toBe("Hello");
  });

  it("returns the input unchanged when no variables are provided", () => {
    const html = "data-duration=\"__VIDEO_DURATION__\"";
    expect(substituteVariables(html, {})).toBe(html);
  });

  it("coerces non-string values to strings", () => {
    expect(substituteVariables("__N__", { __N__: 42 })).toBe("42");
  });
});
