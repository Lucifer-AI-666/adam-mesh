import { describe, expect, it } from "vitest";
import { takeClosedPieces } from "./speechText";

describe("takeClosedPieces", () => {
  it("emette la prima frase e tiene il resto aperto", () => {
    const drained = takeClosedPieces("Il comune è aperto. Gli uffici");
    expect(drained.pieces).toEqual(["Il comune è aperto."]);
    expect(drained.rest).toBe("Gli uffici");
  });

  it("non emette nulla se la frase non è chiusa e è corta", () => {
    const drained = takeClosedPieces("Sto ancora scrivendo");
    expect(drained.pieces).toEqual([]);
    expect(drained.rest).toBe("Sto ancora scrivendo");
  });
});
