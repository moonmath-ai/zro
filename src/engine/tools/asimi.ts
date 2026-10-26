import { BASE_URL, PROVIDER_ID, ZRO_ENV_KEY, type ZroModel } from "../constants.js";
import type { ToolModule } from "../types.js";

// Asimi resolves API keys and base URLs by convention from the provider id:
// <PROVIDER>_API_KEY and <PROVIDER>_BASE_URL. With ASIMI_PROVIDER=zro that is
// ZRO_API_KEY (the shared ZRO_ENV_KEY) and ZRO_BASE_URL. Asimi normalizes the
// base URL itself (strips the /v1 suffix before its OpenAI client re-appends it).
// ASIMI_MODEL/ASIMI_REASONING_EFFORT env overrides beat its config file; the
// --model flag beats both.
const ASIMI_PROVIDER_ENV_KEY = "ASIMI_PROVIDER";
const ASIMI_MODEL_ENV_KEY = "ASIMI_MODEL";
const ASIMI_REASONING_EFFORT_ENV_KEY = "ASIMI_REASONING_EFFORT";
const ASIMI_BASE_URL_ENV_KEY = `${PROVIDER_ID.toUpperCase()}_BASE_URL`;

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

export const asimiTool: ToolModule = {
  id: "asimi",
  label: "Asimi",
  async launch(ctx) {
    const model = ctx.models.find((candidate) => candidate.id === ctx.model);
    const env: Record<string, string> = {
      [ZRO_ENV_KEY]: ctx.apiKey,
      [ASIMI_BASE_URL_ENV_KEY]: BASE_URL,
      [ASIMI_PROVIDER_ENV_KEY]: PROVIDER_ID,
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
      args: ["--model", ctx.model, "--provider", PROVIDER_ID, ...ctx.extraArgs],
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
