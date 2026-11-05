import { commandExists } from "../../install.js";
import type { ZroModel } from "../constants.js";
import type { LaunchContext, ToolModule } from "../types.js";

// Asimi talks to any OpenAI-compatible endpoint through its "openai" provider:
// OPENAI_API_KEY provides the key and OPENAI_BASE_URL the endpoint (asimi
// normalizes the base URL itself, stripping the /v1 suffix before its client
// re-appends it). A custom provider id would resolve ZRO_API_KEY/ZRO_BASE_URL
// by convention, but asimi only collects keys from the environment for its
// standard providers, so the openai route is the one that works headless.
// ASIMI_MODEL/ASIMI_REASONING_EFFORT env overrides beat its config file; the
// --model flag beats both.
const ASIMI_PROVIDER = "openai";
const ASIMI_PROVIDER_ENV_KEY = "ASIMI_PROVIDER";
const ASIMI_MODEL_ENV_KEY = "ASIMI_MODEL";
const ASIMI_REASONING_EFFORT_ENV_KEY = "ASIMI_REASONING_EFFORT";
const OPENAI_API_KEY_ENV_KEY = "OPENAI_API_KEY";
const OPENAI_BASE_URL_ENV_KEY = "OPENAI_BASE_URL";

// Asimi only accepts low|medium|high. Catalog levels outside that set (off,
// minimal, xhigh) map to the nearest accepted effort; this can differ from
// what the server sent, so the env var is omitted entirely when there is no
// sensible mapping rather than guessing.
const EFFORT_BY_PI_LEVEL: Partial<Record<ZroModel["reasoning"]["levels"][number]["piLevel"], string>> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high"
};

// Asimi runs the agent shell in a podman sandbox and builds the sandbox image
// through the Justfile its :init command generates, so both must be on PATH.
const SANDBOX_DEPENDENCIES = ["podman", "just"] as const;

async function ensureSandboxDependencies(ctx: LaunchContext): Promise<void> {
  const missing: string[] = [];
  for (const dependency of SANDBOX_DEPENDENCIES) {
    if (!(await commandExists(dependency, ctx.env, ctx.platform))) missing.push(dependency);
  }
  if (missing.length > 0) {
    throw new Error(
      `Asimi needs ${missing.join(" and ")} to run its shell in a podman sandbox. ` +
        "Install it (podman: https://podman.io/docs/installation, just: https://github.com/casey/just) " +
        "and run zro asimi again."
    );
  }
}

export const asimiTool: ToolModule = {
  id: "asimi",
  label: "Asimi",
  async launch(ctx) {
    await ensureSandboxDependencies(ctx);
    const model = ctx.models.find((candidate) => candidate.id === ctx.model);
    const env: Record<string, string> = {
      [OPENAI_API_KEY_ENV_KEY]: ctx.apiKey,
      [OPENAI_BASE_URL_ENV_KEY]: ctx.inferenceBaseUrl,
      [ASIMI_PROVIDER_ENV_KEY]: ASIMI_PROVIDER,
      [ASIMI_MODEL_ENV_KEY]: ctx.model
    };
    const effort = model ? reasoningEffort(model) : undefined;
    if (effort) {
      env[ASIMI_REASONING_EFFORT_ENV_KEY] = effort;
    }
    return {
      tool: "asimi",
      label: "Asimi",
      model: ctx.model,
      command: "asimi",
      args: ["--model", ctx.model, "--provider", ASIMI_PROVIDER, ...ctx.extraArgs],
      env,
      message: "Launch Asimi with Zro"
    };
  }
};

export function reasoningEffort(model: ZroModel): string | undefined {
  const level = model.reasoning.levels.find(
    (candidate) => candidate.id === model.reasoning.defaultLevel
  );
  return level ? EFFORT_BY_PI_LEVEL[level.piLevel] : undefined;
}
