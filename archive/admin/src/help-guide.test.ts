import { describe, expect, it } from "vitest";
import { productGuide } from "./help-guide";

describe("Workrr product handbook", () => {
  it("documents the complete product surface in plain language", () => {
    const sectionIds = productGuide.map((section) => section.id);
    expect(sectionIds).toEqual(expect.arrayContaining([
      "welcome", "map", "process", "execution", "memory", "fields",
      "tools", "controls", "models", "evidence", "examples", "glossary"
    ]));
    expect(productGuide.length).toBeGreaterThanOrEqual(12);
    expect(productGuide.flatMap((section) => section.topics).length).toBeGreaterThanOrEqual(40);
  });

  it("defines the important Cloudflare execution and process concepts", () => {
    const handbook = JSON.stringify(productGuide);
    for (const concept of [
      "Instant Agent", "Durable Actor", "Workflow", "Queue",
      "Thread ID", "Idempotency Key", "Workers AI", "D1",
      "Human Approval", "Business Owner"
    ]) {
      expect(handbook).toContain(concept);
    }
  });

  it("gives every topic a simple explanation and useful details", () => {
    for (const section of productGuide) {
      expect(section.summary.length).toBeGreaterThan(30);
      for (const topic of section.topics) {
        expect(topic.plain.length).toBeGreaterThan(40);
        expect(topic.details.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
