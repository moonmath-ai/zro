// Static fallback catalog mirroring zro/src/engine/constants.ts. The extension
// is CommonJS while the CLI is ESM, so we carry a copy. At runtime the provider
// fetches the live catalog from the control plane (`/api/cli/models`) and only
// falls back to this list when the endpoint is unreachable.

// Type-only import: erased at compile time, keeps this module require-free.
import type { LanguageModelChatInformation } from "vscode";

export const ENDPOINT_ROOT = process.env.ZRO_ENDPOINT_ROOT ?? "https://zro.moonmath.ai";
export const BASE_URL = `${ENDPOINT_ROOT}/v1`;
export const CATALOG_URL = `${ENDPOINT_ROOT}/api/cli/models`;
export const STATUS_URL = `${ENDPOINT_ROOT}/api/cli/status`;
export const ZRO_ENV_KEY = "ZRO_API_KEY";

/**
 * Auth endpoint root. Mirrors the CLI's `getAuthRoot()` resolution: an explicit
 * auth URL wins, then the deployment-specific endpoint root, then the default.
 * Used by the device-code OAuth login flow to reach the control-plane auth API.
 */
export function getAuthRoot(): string {
  return (process.env.ZRO_AUTH_URL || process.env.ZRO_ENDPOINT_ROOT || ENDPOINT_ROOT).replace(/\/+$/, "");
}

/**
 * Rewrite the server-provided approval URL onto a public root when present.
 * Mirrors the CLI's `browserApprovalUrl()`.
 */
export function browserApprovalUrl(serverUrl: string): string {
  const publicRoot = process.env.ZRO_PUBLIC_URL || process.env.ZRO_AUTH_URL;
  if (!publicRoot) return serverUrl;
  const url = new URL(serverUrl);
  return new URL(`${url.pathname}${url.search}${url.hash}`, new URL(publicRoot)).toString();
}

export const PROVIDER_ID = "zro";
export const PROVIDER_NAME = "ZRO";

/**
 * A single reasoning-effort level a model supports. Mirrors
 * `ZroReasoningLevel` in zro/src/engine/constants.ts — only the fields the
 * extension needs (`id`, `description`) are carried; the harness-specific
 * mappings (codexEffort, piLevel, openCodeOptions) live on the CLI side.
 */
export interface ZroReasoningLevel {
  id: string;
  description: string;
}

/** Per-model reasoning configuration advertised by the catalog. */
export interface ZroReasoningConfig {
  defaultLevel: string;
  levels: readonly ZroReasoningLevel[];
}

/**
 * Public per-model pricing advertised by the control plane, in USD per 1M
 * tokens. Rates are the effective ones — an active promotion is already applied
 * — so the price shown is the price a request is billed at. Absent when the
 * model has no published rates (e.g. the `auto` router).
 */
export interface ZroModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
}

export interface ZroModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning?: ZroReasoningConfig;
  pricing?: ZroModelPricing;
  /** True when the model's catalog row advertises image input. */
  imageInput?: boolean;
}

/**
 * One property of VS Code's per-model configuration schema. This is the shape
 * Copilot Chat itself uses for its own models' "Thinking Effort" dropdown:
 * the workbench renders enum'd properties with `group: "navigation"` as a
 * quick picker next to the model picker, and folds the rest into the model's
 * "Configure Model…" action. `LanguageModelChatInformation.configurationSchema`
 * is not yet declared in @types/vscode, so this is defined structurally here.
 */
export interface ZroModelConfigurationProperty {
  readonly type: "string";
  readonly title: string;
  readonly enum: readonly string[];
  /** Per-item labels for the dropdown (falls back to the enum value). */
  readonly enumItemLabels?: readonly string[];
  readonly enumDescriptions: readonly string[];
  readonly default: string;
  readonly group?: string;
}

/** Configuration schema attached to a chat model (see reasoning.ts). */
export interface ZroModelConfigurationSchema {
  readonly properties: Record<string, ZroModelConfigurationProperty>;
}

/**
 * Icon id contributed by this extension through VS Code's `icons` extension
 * point (see `contributes.icons` in package.json; the glyph is built from
 * media/icon.svg by scripts/build-icon-font.py).
 *
 * VS Code renders a model's `statusIcon` as a theme icon — literally
 * `<span class="codicon codicon-<id>">` — so a bitmap or SVG can never appear
 * in the picker. Registering a one-glyph font is the only way a provider can
 * put its own mark next to its models; core then emits
 * `.codicon-zro-logo:before { content: ...; font-family: ... }` for us.
 */
export const ZRO_STATUS_ICON_ID = "zro-logo";

/**
 * Theme-icon reference understood by core's picker renderer
 * (`metadata.statusIcon`). Passed through verbatim by the extension host; not
 * declared in @types/vscode. Without it, models from an unknown vendor render
 * with the default placeholder glyph.
 */
export interface ZroStatusIcon {
  readonly id: string;
  readonly color?: { readonly id: string };
}

/**
 * Value reported as `multiplierNumeric` on every priced model.
 *
 * For Copilot's own models the field is a premium-request multiplier. ZRO has
 * no equivalent, so this is a constant whose only job is to satisfy core's
 * defined-check — the renderer shows nothing else when the field is absent.
 * Deliberately 1 rather than a real cost ratio so core's "exceeds the current
 * model's cost tier" comparison never fires on our models.
 */
export const PRICING_MULTIPLIER = 1;

/**
 * `LanguageModelChatInformation` plus the configuration schema and status icon.
 * The runtime passes both fields through verbatim (verified in this build's
 * extension host), older VS Code builds simply ignore them.
 */
export interface ZroChatInformation extends LanguageModelChatInformation {
  readonly configurationSchema?: ZroModelConfigurationSchema;
  readonly statusIcon?: ZroStatusIcon;
  /**
   * Cost metadata, passed through verbatim by the extension host (verified in
   * this build; builds that predate the fields simply ignore them).
   *
   * `multiplierNumeric` is the gate: core's picker renders nothing else unless
   * it is defined, so every priced model carries {@link PRICING_MULTIPLIER}.
   * `pricing` is a free-form string core appends to the model row's description
   * and shows as "Cost: {pricing}" in the hover card; `priceCategory` adds
   * core's "Low cost"/"High cost" badge to that hover card.
   */
  readonly pricing?: string;
  readonly multiplierNumeric?: number;
  readonly priceCategory?: string;
}

/** Static fallback used when the live catalog cannot be fetched. */
export const ZRO_MODELS: readonly ZroModel[] = [
  {
    id: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    contextWindow: 1048576,
    maxOutputTokens: 384000,
    reasoning: {
      defaultLevel: "high",
      levels: [
        { id: "low", description: "Use DeepSeek low reasoning effort" },
        { id: "high", description: "Use DeepSeek high reasoning effort" },
        { id: "max", description: "Use DeepSeek maximum reasoning effort" }
      ]
    }
  },
  {
    id: "glm-5.3",
    displayName: "GLM-5.3",
    contextWindow: 1048576,
    maxOutputTokens: 131000,
    reasoning: {
      defaultLevel: "max",
      levels: [
        { id: "none", description: "Disable reasoning for the lowest latency" },
        { id: "high", description: "Use GLM High reasoning effort" },
        { id: "max", description: "Use GLM maximum reasoning effort" }
      ]
    }
  },
  {
    id: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "max",
      levels: [
        { id: "none", description: "Disable reasoning for the lowest latency" },
        { id: "high", description: "Use GLM High reasoning effort" },
        { id: "max", description: "Use GLM maximum reasoning effort" }
      ]
    }
  },
  {
    id: "dolly1-security",
    displayName: "Dolly 1 Security",
    contextWindow: 1048576,
    maxOutputTokens: 64000,
    reasoning: {
      defaultLevel: "max",
      levels: [
        { id: "none", description: "Disable reasoning for the lowest latency" },
        { id: "high", description: "Use GLM High reasoning effort" },
        { id: "max", description: "Use GLM maximum reasoning effort" }
      ]
    }
  },
  {
    id: "auto",
    displayName: "Auto",
    contextWindow: 1048576,
    maxOutputTokens: 131000,
    reasoning: {
      defaultLevel: "auto",
      levels: [{ id: "auto", description: "Let the Auto router pick the model per request" }]
    }
  },
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    contextWindow: 1048576,
    maxOutputTokens: 1048576,
    reasoning: {
      defaultLevel: "high",
      levels: [
        { id: "low", description: "Use Kimi low reasoning effort" },
        { id: "high", description: "Use Kimi high reasoning effort" },
        { id: "max", description: "Use Kimi maximum reasoning effort" }
      ]
    }
  }
];

export const DEFAULT_MODEL = ZRO_MODELS[0].id;

/** VS Code settings that control reasoning effort (see package.json configuration). */
export const CONFIG_SECTION = "zro";
export const SETTING_REASONING_EFFORT = "reasoningEffort";
export const SETTING_REASONING_EFFORT_BY_MODEL = "reasoningEffortByModel";

/**
 * Sentinel for "no explicit effort": the proxy then applies the model's native
 * `defaultLevel`, and the extension omits `reasoning_effort` from the request.
 */
export const EFFORT_DEFAULT = "default";

/**
 * Effort levels valid in `zro.reasoningEffort`, on top of `EFFORT_DEFAULT`.
 * The union of every level the catalog has ever advertised — a model only ever
 * sees levels from its own `.reasoning.levels`, so out-of-level values here are
 * simply ignored per model. "medium" and "xhigh" are reserved for future models.
 */
