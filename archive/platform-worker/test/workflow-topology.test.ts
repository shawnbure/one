import { describe, expect, it } from "vitest";
import { normalizeWorkflowTopology } from "../src/studio";

describe("governed workflow topology", () => {
  it("keeps Cloudflare primitives and release policy in a bounded linear graph", () => {
    const topology = normalizeWorkflowTopology("workflow", "approve", ["lookup_customer"], {
      businessSteps: [
        { id: "client-controlled", type: "decision", label: "Classify the request" },
        { type: "checkpoint", label: "Confirm required evidence" }
      ]
    });
    expect(topology.layout).toBe("linear");
    expect(topology.nodes.map((node) => node.type)).toEqual([
      "trigger", "queue", "agent", "decision", "checkpoint", "tool", "approval", "outcome"
    ]);
    expect(topology.businessSteps[0]).toMatchObject({
      id: "business-1", type: "decision", label: "Classify the request"
    });
    expect(topology.edges).toHaveLength(topology.nodes.length - 1);
    expect(topology.edges.every((edge, index) =>
      edge.from === topology.nodes[index]?.id && edge.to === topology.nodes[index + 1]?.id)).toBe(true);
  });

  it("does not let clients remove required runtime or approval boundaries", () => {
    const topology = normalizeWorkflowTopology("conversation", "guarded", [], {
      nodes: [], edges: [], businessSteps: [{ type: "step", label: "Prepare recommendation" }]
    });
    expect(topology.nodes[0]?.type).toBe("trigger");
    expect(topology.nodes.some((node) => node.type === "agent")).toBe(true);
    expect(topology.nodes.some((node) => node.type === "approval")).toBe(true);
    expect(topology.nodes.at(-1)?.type).toBe("outcome");
  });

  it("rejects unbounded, duplicate, or unsupported business steps", () => {
    expect(() => normalizeWorkflowTopology("instant", "suggest", [], {
      businessSteps: Array.from({ length: 9 }, (_, index) => ({
        type: "step", label: `Step ${index + 1}`
      }))
    })).toThrow("at most 8");
    expect(() => normalizeWorkflowTopology("instant", "suggest", [], {
      businessSteps: [
        { type: "step", label: "Review request" },
        { type: "decision", label: " review   request " }
      ]
    })).toThrow("unique");
    expect(() => normalizeWorkflowTopology("instant", "suggest", [], {
      businessSteps: [{ type: "loop", label: "Repeat forever" }]
    })).toThrow("unsupported");
  });
});
