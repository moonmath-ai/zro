import fs from "node:fs/promises";
import type { Serializer } from "./serializers.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(filePath: string, serializer: Serializer): Promise<Record<string, unknown>> {
  if (!(await fileExists(filePath))) return {};
  const text = await fs.readFile(filePath, "utf8");
  return serializer.parse(text) as Record<string, unknown>;
}
