import customerOperationsManifest from "../../../solution-packs/customer-operations/manifest.json";
import customerOperationsProcess from "../../../solution-packs/customer-operations/process.json";
import scheduledReconciliationManifest from "../../../solution-packs/scheduled-reconciliation/manifest.json";
import scheduledReconciliationProcess from "../../../solution-packs/scheduled-reconciliation/process.json";
import { validateProcessPackage, type PortableProcessPackage } from "./process-package";

interface SolutionPackManifest {
  schema: "workrr-solution-pack/v1";
  id: string;
  version: string;
  name: string;
  summary: string;
  audience: string;
  processArtifact: string;
  requiredConnections: Array<{ tool: string; access: string; minimumScope: string; owner: string }>;
  handoffChecks: string[];
  secrets: "excluded";
}

export interface SolutionPackCatalogItem {
  id: string;
  version: string;
  name: string;
  summary: string;
  audience: string;
  process: {
    name: string;
    executionProfile: string;
    modelProfile: string;
    modelId: string | null;
    autonomy: string;
    riskLevel: string;
    dataClassification: string;
    toolCount: number;
    acceptanceCaseCount: number;
  };
  requiredConnections: SolutionPackManifest["requiredConnections"];
  handoffChecks: string[];
  installBehavior: {
    status: "draft";
    operatingMode: "paused";
    credentialsImported: false;
    schedulesEnabled: false;
    publicationGranted: false;
  };
}

const sourcePacks = [
  { manifest: customerOperationsManifest, process: customerOperationsProcess },
  { manifest: scheduledReconciliationManifest, process: scheduledReconciliationProcess }
] as const;

const packs = sourcePacks.map(({ manifest, process }) => {
  const checkedManifest = validateManifest(manifest);
  const checkedProcess = validateProcessPackage(process);
  return { manifest: checkedManifest, process: checkedProcess };
});

export function listSolutionPacks(): SolutionPackCatalogItem[] {
  return packs.map(({ manifest, process }) => ({
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    summary: manifest.summary,
    audience: manifest.audience,
    process: {
      name: process.process.name,
      executionProfile: process.process.executionProfile,
      modelProfile: process.process.modelProfile,
      modelId: process.process.modelId ?? null,
      autonomy: process.process.autonomy,
      riskLevel: process.process.riskLevel,
      dataClassification: process.process.dataClassification ?? "internal",
      toolCount: process.process.toolDefinitions?.length ?? process.process.tools.length,
      acceptanceCaseCount: process.behavior.acceptanceCases?.length ?? 0
    },
    requiredConnections: manifest.requiredConnections.map((item) => ({ ...item })),
    handoffChecks: [...manifest.handoffChecks],
    installBehavior: {
      status: "draft",
      operatingMode: "paused",
      credentialsImported: false,
      schedulesEnabled: false,
      publicationGranted: false
    }
  }));
}

export function resolveSolutionPack(id: string, version: string): PortableProcessPackage {
  const match = packs.find((item) => item.manifest.id === id && item.manifest.version === version);
  if (!match) throw new Error("Solution pack or version was not found");
  return structuredClone(match.process);
}

function validateManifest(value: unknown): SolutionPackManifest {
  if (!value || typeof value !== "object") throw new Error("Solution pack manifest is invalid");
  const manifest = value as Partial<SolutionPackManifest>;
  if (manifest.schema !== "workrr-solution-pack/v1" || !manifest.id?.trim() ||
      !manifest.version?.match(/^\d+\.\d+\.\d+$/) || !manifest.name?.trim() ||
      !manifest.summary?.trim() || !manifest.audience?.trim() ||
      manifest.processArtifact !== "process.json" || manifest.secrets !== "excluded" ||
      !Array.isArray(manifest.requiredConnections) || !Array.isArray(manifest.handoffChecks) ||
      manifest.handoffChecks.length === 0) {
    throw new Error("Solution pack manifest is incomplete");
  }
  return manifest as SolutionPackManifest;
}
