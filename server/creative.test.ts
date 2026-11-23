import { describe, expect, it } from "vitest";
import { extractAssets, renderWorkflow } from "./creative";

describe("Creative Studio - workflow template", () => {
  it("fills text, frame count, seconds, and seed with correct types", () => {
    const graph = {
      "1": { class_type: "Text", inputs: { text: "{{PROMPT}}", hint: "Style: {{PROMPT}}" } },
      "2": { class_type: "Video", inputs: { frames: "{{FRAMES}}", seconds: "{{SECONDS}}", seed: "{{SEED}}" } },
    };
    const result = renderWorkflow(graph, "Cielo blu", 8, 1234) as typeof graph;
    expect(result["1"].inputs.text).toBe("Cielo blu");
    expect(result["1"].inputs.hint).toBe("Style: Cielo blu");
    expect(result["2"].inputs.frames).toBe(96);
    expect(result["2"].inputs.seconds).toBe(8);
    expect(result["2"].inputs.seed).toBe(1234);
    expect(graph["1"].inputs.text).toBe("{{PROMPT}}"); // no mutation
  });

  it("treats user text as inert data", () => {
    const malicious = "{{SEED}} <script>alert(1)</script>";
    expect(renderWorkflow({ value: "{{PROMPT}}" }, malicious, 4, 55)).toEqual({ value: malicious });
  });
});

describe("Creative Studio - output filtering", () => {
  it("accepts only allowed output video files", () => {
    const history = { outputs: {
      "1": { videos: [
        { filename: "clip_001.mp4", subfolder: "", type: "output" },
        { filename: "../other.mp4", subfolder: "", type: "output" },
        { filename: "secret.mp4", subfolder: "", type: "input" },
        { filename: "script.exe", subfolder: "", type: "output" },
      ] },
    } };
    expect(extractAssets(history, "video")).toEqual([
      { filename: "clip_001.mp4", subfolder: "", type: "output", mime: "video/mp4" },
    ]);
  });

  it("supports audio outputs and rejects a wrong media category", () => {
    const history = { outputs: { "9": { audio: [
      { filename: "track.wav", subfolder: "music", type: "output" },
      { filename: "track.mp3", subfolder: "../../data", type: "output" },
    ] } } };
    expect(extractAssets(history, "music")).toEqual([
      { filename: "track.wav", subfolder: "music", type: "output", mime: "audio/wav" },
    ]);
    expect(extractAssets(history, "video")).toEqual([]);
  });

  it("handles missing or malformed history", () => {
    expect(extractAssets(null, "video")).toEqual([]);
    expect(extractAssets({ outputs: {} }, "music")).toEqual([]);
  });
});
