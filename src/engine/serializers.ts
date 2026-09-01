import JSON5 from "json5";
import YAML from "yaml";

export interface Serializer {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config root must be an object.");
  }
  return value as Record<string, unknown>;
}

export const jsonSerializer: Serializer = {
  parse(text) {
    return asObject(text.trim() ? JSON.parse(text) : {});
  },
  stringify(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
};

export const json5Serializer: Serializer = {
  parse(text) {
    return asObject(text.trim() ? JSON5.parse(text) : {});
  },
  stringify(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
};

export const yamlSerializer: Serializer = {
  parse(text) {
    return asObject(text.trim() ? YAML.parse(text) : {});
  },
  stringify(value) {
    return YAML.stringify(value, { lineWidth: 0 });
  }
};
