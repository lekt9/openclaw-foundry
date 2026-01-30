/**
 * Self-Writer — The core of unlearn.
 *
 * Writes code into itself:
 * 1. Observe what's needed (from hooks, failures, research)
 * 2. Write the code (tool, hook, skill, or technique)
 * 3. Register it immediately
 * 4. Persist it so it's available next session
 *
 * No archive, no fitness scores. Just write and use.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WrittenCode {
  id: string;
  type: "tool" | "hook" | "skill" | "technique";
  name: string;
  description: string;
  code: string;
  createdAt: string;
  source: string; // What triggered this (research, failure, request)
}

export interface SelfWriterConfig {
  dataDir: string;
  logger?: { info: (msg: string) => void; error: (msg: string) => void };
}

// ── Self Writer ──────────────────────────────────────────────────────────────

export class SelfWriter {
  private writtenDir: string;
  private manifest: WrittenCode[] = [];
  private manifestPath: string;

  constructor(private config: SelfWriterConfig) {
    this.writtenDir = join(config.dataDir, "written");
    this.manifestPath = join(this.writtenDir, "manifest.json");

    // Ensure directory exists
    if (!existsSync(this.writtenDir)) {
      mkdirSync(this.writtenDir, { recursive: true });
    }

    this.loadManifest();
  }

  private loadManifest(): void {
    if (existsSync(this.manifestPath)) {
      try {
        const data = JSON.parse(readFileSync(this.manifestPath, "utf-8"));
        this.manifest = Array.isArray(data) ? data : [];
      } catch {
        this.manifest = [];
      }
    }
  }

  private saveManifest(): void {
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  /**
   * Write a new piece of code into the system.
   */
  write(entry: Omit<WrittenCode, "id" | "createdAt">): WrittenCode {
    const id = `${entry.type}-${entry.name}-${Date.now()}`;
    const full: WrittenCode = {
      ...entry,
      id,
      createdAt: new Date().toISOString(),
    };

    // Save the code file
    const codePath = join(this.writtenDir, `${id}.ts`);
    writeFileSync(codePath, entry.code);

    // Update manifest
    this.manifest.push(full);
    this.saveManifest();

    this.config.logger?.info(`[self-writer] Wrote ${entry.type}: ${entry.name}`);

    return full;
  }

  /**
   * Write a new tool.
   */
  writeTool(name: string, description: string, code: string, source: string): WrittenCode {
    // Wrap code in tool format if needed
    const toolCode = code.includes("inputSchema") ? code : `
// Auto-generated tool: ${name}
// Source: ${source}

export const tool = {
  name: "${name}",
  description: "${description.replace(/"/g, '\\"')}",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  },
  async execute(params) {
${code.split("\n").map(l => "    " + l).join("\n")}
  }
};

export default tool;
`;

    return this.write({
      type: "tool",
      name,
      description,
      code: toolCode,
      source,
    });
  }

  /**
   * Write a new hook.
   */
  writeHook(
    name: string,
    event: string,
    description: string,
    handlerCode: string,
    source: string,
  ): WrittenCode {
    const hookCode = `
// Auto-generated hook: ${name}
// Event: ${event}
// Source: ${source}

export const hookEvent = "${event}";
export const hookName = "${name}";

export async function handler(event, ctx) {
${handlerCode.split("\n").map(l => "  " + l).join("\n")}
}

export default { event: hookEvent, name: hookName, handler };
`;

    return this.write({
      type: "hook",
      name,
      description,
      code: hookCode,
      source,
    });
  }

  /**
   * Write a technique (reusable pattern/function).
   */
  writeTechnique(name: string, description: string, code: string, source: string): WrittenCode {
    const techniqueCode = `
// Auto-generated technique: ${name}
// Source: ${source}
// Description: ${description}

${code}

export default { name: "${name}", description: "${description.replace(/"/g, '\\"')}" };
`;

    return this.write({
      type: "technique",
      name,
      description,
      code: techniqueCode,
      source,
    });
  }

  /**
   * Get all written code of a specific type.
   */
  getByType(type: WrittenCode["type"]): WrittenCode[] {
    return this.manifest.filter(w => w.type === type);
  }

  /**
   * Get all written code.
   */
  getAll(): WrittenCode[] {
    return this.manifest;
  }

  /**
   * Load the actual code for a written entry.
   */
  loadCode(id: string): string | null {
    const codePath = join(this.writtenDir, `${id}.ts`);
    if (existsSync(codePath)) {
      return readFileSync(codePath, "utf-8");
    }
    return null;
  }

  /**
   * Delete written code.
   */
  delete(id: string): boolean {
    const index = this.manifest.findIndex(w => w.id === id);
    if (index === -1) return false;

    // Remove from manifest
    this.manifest.splice(index, 1);
    this.saveManifest();

    // Delete file (if exists)
    const codePath = join(this.writtenDir, `${id}.ts`);
    if (existsSync(codePath)) {
      require("fs").unlinkSync(codePath);
    }

    return true;
  }

  /**
   * Get summary of what's been written.
   */
  getSummary(): string {
    const tools = this.getByType("tool");
    const hooks = this.getByType("hook");
    const techniques = this.getByType("technique");

    let output = `## Self-Written Code\n\n`;
    output += `- **Tools**: ${tools.length}\n`;
    output += `- **Hooks**: ${hooks.length}\n`;
    output += `- **Techniques**: ${techniques.length}\n\n`;

    if (tools.length > 0) {
      output += `### Tools\n`;
      for (const t of tools) {
        output += `- **${t.name}**: ${t.description} (from: ${t.source})\n`;
      }
      output += "\n";
    }

    if (hooks.length > 0) {
      output += `### Hooks\n`;
      for (const h of hooks) {
        output += `- **${h.name}**: ${h.description} (from: ${h.source})\n`;
      }
      output += "\n";
    }

    if (techniques.length > 0) {
      output += `### Techniques\n`;
      for (const t of techniques) {
        output += `- **${t.name}**: ${t.description} (from: ${t.source})\n`;
      }
    }

    return output;
  }
}

// ── Code Templates ───────────────────────────────────────────────────────────

export const TEMPLATES = {
  tool: (name: string, description: string, logic: string) => `
export const tool = {
  name: "${name}",
  description: "${description}",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  },
  async execute(params) {
    ${logic}
  }
};
`,

  hook: (name: string, event: string, logic: string) => `
export const hook = {
  event: "${event}",
  name: "${name}",
  async handler(event, ctx) {
    ${logic}
  }
};
`,

  technique: (name: string, logic: string) => `
export function ${name}(input) {
  ${logic}
}
`,
};
