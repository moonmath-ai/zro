import path from "node:path";
import { BASE_URL, MCP_URL, PROVIDER_ID, ZRO_ENV_KEY } from "../constants.js";
import type { ToolModule } from "../types.js";

// Nanocodex is a Codex-derived harness with a closed model catalog and no
// provider abstraction: `--model` only accepts the six native ids, and the
// on-wire identifier is always `<prefix>/<native id>`. Zro serves its own id
// set (deepseek-v4.1-flash, glm-5.3, glm-5.3-flash, dolly1-security, auto,
// kimi-k3), so a model Nanocodex does not already know is routed by putting the
// Zro id in NANOCODEX_MODEL_ID_PREFIX and seating the request in a compatible
// base slot (the prefix is what the Zro gateway routes on). Native ids pass
// through bare. Zro serves the Responses API over HTTPS with no WebSocket
// endpoint, so the transport default is forced to HTTPS. The API key rides in
// OPENAI_API_KEY and never touches disk; the generated config references it by
// name only.
const NANOCODEX_API_KEY_ENV_KEY = "OPENAI_API_KEY";
const NANOCODEX_BASE_URL_ENV_KEY = "OPENAI_API_BASE_URL";
const NANOCODEX_CODEX_HOME_ENV_KEY = "CODEX_HOME";
const NANOCODEX_MODEL_ID_PREFIX_ENV_KEY = "NANOCODEX_MODEL_ID_PREFIX";
const NANOCODEX_TRANSPORT_ENV_KEY = "NANOCODEX_RESPONSES_TRANSPORT";

// Fallback slot for Zro models outside Nanocodex's closed catalog. The prefix
// carries the real Zro model id, so the base only shapes client-side behavior
// (context accounting, prompt, reasoning policy).
export const NANOCODEX_FALLBACK_MODEL = "gpt-6-astra";

// Every id `Model::from_str` accepts in Nanocodex, including its aliases.
const NANOCODEX_NATIVE_MODELS = new Set([
  "gpt-6.1-sol",
  "gpt-6-luna",
  "gpt-6-astra",
  "@cf/zai-org/glm-5.3",
  "kimi-k3",
  "mimo-v2.6-pro",
  "sol",
  "luna",
  "astra",
  "glm-5.3",
  "glm53",
  "kimi",
  "mimo"
]);

export const nanocodexTool: ToolModule = {
  id: "nanocodex",
  label: "Nanocodex",
  async launch(ctx) {
    const codexHome = path.join(ctx.tempDir, "nanocodex", "codex");
    const native = NANOCODEX_NATIVE_MODELS.has(ctx.model.toLowerCase());
    const base = native ? ctx.model : NANOCODEX_FALLBACK_MODEL;
    return {
      tool: "nanocodex",
      label: "Nanocodex",
      model: ctx.model,
      command: "nanocodex",
      args: ["--harness", "codex", "--model", base, ...ctx.extraArgs],
      env: {
        [NANOCODEX_CODEX_HOME_ENV_KEY]: codexHome,
        [NANOCODEX_API_KEY_ENV_KEY]: ctx.apiKey,
        [NANOCODEX_BASE_URL_ENV_KEY]: BASE_URL,
        [NANOCODEX_TRANSPORT_ENV_KEY]: "https",
        ...(native ? {} : { [NANOCODEX_MODEL_ID_PREFIX_ENV_KEY]: ctx.model }),
        [ZRO_ENV_KEY]: ctx.apiKey,
        OTEL_SDK_DISABLED: "true",
        DO_NOT_TRACK: "1"
      },
      files: [
        {
          path: path.join(codexHome, "config.toml"),
          contents: buildNanocodexMcpConfig()
        }
      ],
      message: "Launch Nanocodex with Zro"
    };
  }
};

export function buildNanocodexMcpConfig(): string {
  return [
    `[mcp_servers.${PROVIDER_ID}]`,
    `url = ${tomlString(MCP_URL)}`,
    `bearer_token_env_var = ${tomlString(ZRO_ENV_KEY)}`,
    ""
  ].join("\n");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
