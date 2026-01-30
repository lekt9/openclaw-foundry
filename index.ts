/**
 * Foundry — Self-writing coding subagent for Clawdbot.
 *
 * A meta-extension that researches best practices and writes code into:
 * - Clawdbot extensions (tools, hooks)
 * - Skills (SKILL.md + api.ts)
 * - The extension itself
 *
 * Grounded in docs.molt.bot/llms.txt — fetches documentation on demand.
 *
 * Tools:
 *   foundry_research     — Search docs.molt.bot for best practices
 *   foundry_implement    — Research + implement a capability
 *   foundry_write_extension — Write a new clawdbot extension
 *   foundry_write_skill  — Write a skill package
 *   foundry_add_tool     — Add a tool to an existing extension
 *   foundry_add_hook     — Add a hook to an existing extension
 *   foundry_list         — List written extensions/skills
 *   foundry_docs         — Read clawdbot plugin/hooks documentation
 */

import type { ClawdbotPluginApi, ClawdbotPluginToolContext } from "clawdbot/plugin-sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Documentation URLs ───────────────────────────────────────────────────────

const DOCS_BASE = "https://docs.molt.bot";
const LLMS_TXT = `${DOCS_BASE}/llms.txt`;

// Key documentation pages for different capabilities
const DOC_PAGES: Record<string, string[]> = {
  plugin: ["/tools/plugin"],
  hooks: ["/automation/hooks"],
  tools: ["/tools/tools", "/tools/lobster", "/tools/exec"],
  browser: ["/tools/browser", "/tools/browser-login"],
  skills: ["/tools/skills", "/tools/skills-config"],
  agent: ["/concepts/agent", "/concepts/agent-loop", "/concepts/system-prompt"],
  gateway: ["/gateway/gateway", "/gateway/configuration", "/gateway/protocol"],
  channels: ["/channels/index", "/channels/whatsapp", "/channels/telegram", "/channels/discord"],
  memory: ["/concepts/memory", "/cli/memory"],
  models: ["/concepts/models", "/concepts/model-providers"],
  automation: ["/automation/hooks", "/automation/cron-jobs", "/automation/webhook"],
  nodes: ["/nodes/nodes", "/nodes/camera"],
  security: ["/gateway/security", "/gateway/sandboxing"],
};

// ── Documentation Fetcher ────────────────────────────────────────────────────

class DocsFetcher {
  private cache: Map<string, { content: string; fetchedAt: number }> = new Map();
  private cacheTtl = 1000 * 60 * 30; // 30 minutes

  async fetchPage(path: string): Promise<string> {
    const url = path.startsWith("http") ? path : `${DOCS_BASE}${path}`;

    // Check cache
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtl) {
      return cached.content;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) return `Failed to fetch ${url}: ${res.status}`;

      const html = await res.text();
      // Extract main content - simple markdown extraction
      const content = this.extractContent(html);

      this.cache.set(url, { content, fetchedAt: Date.now() });
      return content;
    } catch (err) {
      return `Error fetching ${url}: ${(err as Error).message}`;
    }
  }

  async fetchForTopic(topic: string): Promise<string> {
    const pages = DOC_PAGES[topic.toLowerCase()];
    if (!pages) {
      // Try to find matching topic
      const matchingTopic = Object.keys(DOC_PAGES).find(k =>
        k.includes(topic.toLowerCase()) || topic.toLowerCase().includes(k)
      );
      if (matchingTopic) {
        return this.fetchForTopic(matchingTopic);
      }
      return `No documentation pages mapped for topic: ${topic}. Available topics: ${Object.keys(DOC_PAGES).join(", ")}`;
    }

    const results: string[] = [];
    for (const page of pages.slice(0, 2)) { // Limit to 2 pages to avoid too much content
      const content = await this.fetchPage(page);
      results.push(`## ${page}\n\n${content.slice(0, 4000)}`);
    }
    return results.join("\n\n---\n\n");
  }

  async search(query: string): Promise<string> {
    // Find relevant topics based on query keywords
    const queryLower = query.toLowerCase();
    const relevantTopics: string[] = [];

    for (const [topic, pages] of Object.entries(DOC_PAGES)) {
      if (queryLower.includes(topic) || topic.includes(queryLower.split(" ")[0])) {
        relevantTopics.push(topic);
      }
    }

    // Check for specific keywords
    if (queryLower.includes("hook") || queryLower.includes("event")) relevantTopics.push("hooks");
    if (queryLower.includes("tool") || queryLower.includes("plugin")) relevantTopics.push("plugin", "tools");
    if (queryLower.includes("browser") || queryLower.includes("playwright")) relevantTopics.push("browser");
    if (queryLower.includes("skill") || queryLower.includes("api")) relevantTopics.push("skills");
    if (queryLower.includes("agent") || queryLower.includes("prompt")) relevantTopics.push("agent");
    if (queryLower.includes("channel") || queryLower.includes("message")) relevantTopics.push("channels");
    if (queryLower.includes("cron") || queryLower.includes("schedule")) relevantTopics.push("automation");

    const uniqueTopics = [...new Set(relevantTopics)].slice(0, 3);

    if (uniqueTopics.length === 0) {
      return `No matching documentation found for: "${query}"\n\nAvailable topics: ${Object.keys(DOC_PAGES).join(", ")}`;
    }

    const results: string[] = [`# Documentation for: ${query}\n`];
    for (const topic of uniqueTopics) {
      const content = await this.fetchForTopic(topic);
      results.push(`## Topic: ${topic}\n\n${content.slice(0, 3000)}`);
    }

    return results.join("\n\n---\n\n");
  }

  private extractContent(html: string): string {
    // Remove scripts, styles, nav
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

    // Convert common HTML to markdown-ish
    content = content
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n")
      .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
      .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
      .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
      .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "") // Remove remaining tags
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
      .trim();

    return content;
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const EXTENSION_TEMPLATE = `/**
 * {{NAME}} — Auto-generated by foundry
 * {{DESCRIPTION}}
 * Generated: {{DATE}}
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

export default {
  id: "{{ID}}",
  name: "{{NAME}}",
  description: "{{DESCRIPTION}}",

  register(api: ClawdbotPluginApi) {
    const logger = api.logger;

{{TOOLS}}

{{HOOKS}}

    logger.info("[{{ID}}] Extension loaded");
  },
};
`;

const TOOL_TEMPLATE = `    api.registerTool({
      name: "{{NAME}}",
      label: "{{LABEL}}",
      description: "{{DESCRIPTION}}",
      parameters: {
        type: "object",
        properties: {
{{PROPERTIES}}
        },
        required: [{{REQUIRED}}],
      },
      async execute(_toolCallId: string, params: unknown) {
        const p = params as any;
{{CODE}}
      },
    });
`;

const HOOK_TEMPLATE = `    api.on("{{EVENT}}", async (event: any, ctx: any) => {
{{CODE}}
    });
`;

const PLUGIN_JSON_TEMPLATE = `{
  "id": "{{ID}}",
  "name": "{{NAME}}",
  "description": "{{DESCRIPTION}}",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
`;

const SKILL_TEMPLATE = `# {{NAME}} Skill

{{DESCRIPTION}}

## Endpoints

{{ENDPOINTS}}

## Usage

\`\`\`typescript
import { {{CLIENT_NAME}} } from "./api";

const client = new {{CLIENT_NAME}}();
// Use the client methods...
\`\`\`

## Auth

{{AUTH_INFO}}
`;

const API_CLIENT_TEMPLATE = `/**
 * {{NAME}} API Client
 * Auto-generated by foundry
 */

const BASE_URL = "{{BASE_URL}}";

export class {{CLIENT_NAME}} {
  private headers: Record<string, string>;

  constructor(authHeaders?: Record<string, string>) {
    this.headers = {
      "Content-Type": "application/json",
      ...authHeaders,
    };
  }

{{METHODS}}
}

export default {{CLIENT_NAME}};
`;

// ── Types ────────────────────────────────────────────────────────────────────

interface LearningEntry {
  id: string;
  type: "failure" | "success" | "pattern" | "insight";
  tool?: string;
  error?: string;
  resolution?: string;
  context?: string;
  timestamp: string;
  useCount: number;
}

interface PendingSession {
  agentId: string;
  channelId?: string;
  conversationId?: string;
  lastMessage: string;
  context: string;
  reason: string;
  createdAt: string;
}

interface ExtensionDef {
  id: string;
  name: string;
  description: string;
  tools: ToolDef[];
  hooks: HookDef[];
  createdAt: string;
}

interface ToolDef {
  name: string;
  label?: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  code: string;
}

interface HookDef {
  event: string;
  code: string;
}

interface SkillDef {
  name: string;
  description: string;
  baseUrl: string;
  endpoints: EndpointDef[];
  authHeaders?: Record<string, string>;
  createdAt: string;
}

interface EndpointDef {
  method: string;
  path: string;
  description: string;
  params?: Record<string, string>;
}

// ── Extension Writer ─────────────────────────────────────────────────────────

class CodeWriter {
  private extensionsDir: string;
  private skillsDir: string;
  private manifestPath: string;
  private manifest: { extensions: ExtensionDef[]; skills: SkillDef[] } = { extensions: [], skills: [] };
  private clawdbotDocs: { plugin: string; hooks: string } = { plugin: "", hooks: "" };

  constructor(
    private dataDir: string,
    private clawdbotPath: string,
    private logger?: { info: (msg: string) => void },
  ) {
    this.extensionsDir = join(homedir(), ".clawdbot", "extensions");
    this.skillsDir = join(homedir(), ".clawdbot", "skills");
    this.manifestPath = join(dataDir, "manifest.json");

    if (!existsSync(this.extensionsDir)) mkdirSync(this.extensionsDir, { recursive: true });
    if (!existsSync(this.skillsDir)) mkdirSync(this.skillsDir, { recursive: true });

    this.loadManifest();
    this.loadClawdbotDocs();
  }

  private loadManifest(): void {
    if (existsSync(this.manifestPath)) {
      try {
        const data = JSON.parse(readFileSync(this.manifestPath, "utf-8"));
        // Ensure manifest has proper structure with arrays
        this.manifest = {
          extensions: Array.isArray(data?.extensions) ? data.extensions : [],
          skills: Array.isArray(data?.skills) ? data.skills : [],
        };
      } catch {
        this.manifest = { extensions: [], skills: [] };
      }
    }
  }

  private saveManifest(): void {
    const dir = join(this.manifestPath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  private loadClawdbotDocs(): void {
    const pluginDocPath = join(this.clawdbotPath, "docs", "plugin.md");
    const hooksDocPath = join(this.clawdbotPath, "docs", "hooks.md");

    if (existsSync(pluginDocPath)) {
      this.clawdbotDocs.plugin = readFileSync(pluginDocPath, "utf-8");
      this.logger?.info("[foundry] Loaded plugin docs");
    }
    if (existsSync(hooksDocPath)) {
      this.clawdbotDocs.hooks = readFileSync(hooksDocPath, "utf-8");
      this.logger?.info("[foundry] Loaded hooks docs");
    }
  }

  getDocs(): { plugin: string; hooks: string } {
    return this.clawdbotDocs;
  }

  // ── Extension Writing ─────────────────────────────────────────────────────

  /**
   * Write extension with validation. Returns { path, validation } or throws on blocked code.
   */
  async writeExtension(
    def: Omit<ExtensionDef, "createdAt">,
    validator?: CodeValidator,
  ): Promise<{ path: string; validation: ValidationResult }> {
    const full: ExtensionDef = { ...def, createdAt: new Date().toISOString() };

    const toolsCode = def.tools.map(t => {
      const props = Object.entries(t.properties)
        .map(([k, v]) => `          ${k}: { type: "${v.type}", description: "${v.description.replace(/"/g, '\\"')}" },`)
        .join("\n");
      const req = t.required.map(r => `"${r}"`).join(", ");

      return TOOL_TEMPLATE
        .replace(/\{\{NAME\}\}/g, t.name)
        .replace(/\{\{LABEL\}\}/g, t.label || t.name)
        .replace(/\{\{DESCRIPTION\}\}/g, t.description.replace(/"/g, '\\"'))
        .replace(/\{\{PROPERTIES\}\}/g, props)
        .replace(/\{\{REQUIRED\}\}/g, req)
        .replace(/\{\{CODE\}\}/g, t.code.split("\n").map(l => "        " + l).join("\n"));
    }).join("\n");

    const hooksCode = def.hooks.map(h => {
      return HOOK_TEMPLATE
        .replace(/\{\{EVENT\}\}/g, h.event)
        .replace(/\{\{CODE\}\}/g, h.code.split("\n").map(l => "      " + l).join("\n"));
    }).join("\n");

    const extensionCode = EXTENSION_TEMPLATE
      .replace(/\{\{ID\}\}/g, def.id)
      .replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{DATE\}\}/g, full.createdAt)
      .replace(/\{\{TOOLS\}\}/g, toolsCode)
      .replace(/\{\{HOOKS\}\}/g, hooksCode);

    // Validate before writing
    let validation: ValidationResult = { valid: true, errors: [], warnings: [], securityFlags: [] };
    if (validator) {
      validation = await validator.validate(extensionCode, "extension");

      // Block if validation failed
      if (!validation.valid) {
        this.logger?.info(`[foundry] Extension ${def.id} BLOCKED: ${validation.errors.join(", ")}`);
        throw new Error(`Code validation failed: ${validation.errors.join(", ")}`);
      }

      // Log warnings
      if (validation.warnings.length > 0) {
        this.logger?.info(`[foundry] Extension ${def.id} warnings: ${validation.warnings.join(", ")}`);
      }

      // Run in sandbox to catch runtime errors BEFORE writing
      const sandboxDir = join(this.dataDir, "sandbox");
      const sandboxResult = await validator.testInSandbox(extensionCode, sandboxDir);
      if (!sandboxResult.success) {
        this.logger?.info(`[foundry] Extension ${def.id} SANDBOX FAILED: ${sandboxResult.error}`);
        throw new Error(`Sandbox test failed: ${sandboxResult.error}`);
      }
      this.logger?.info(`[foundry] Extension ${def.id} passed sandbox test`);
    }

    const extDir = join(this.extensionsDir, def.id);
    if (!existsSync(extDir)) mkdirSync(extDir, { recursive: true });

    writeFileSync(join(extDir, "index.ts"), extensionCode);
    writeFileSync(
      join(extDir, "clawdbot.plugin.json"),
      PLUGIN_JSON_TEMPLATE
        .replace(/\{\{ID\}\}/g, def.id)
        .replace(/\{\{NAME\}\}/g, def.name)
        .replace(/\{\{DESCRIPTION\}\}/g, def.description),
    );

    const idx = this.manifest.extensions.findIndex(e => e.id === def.id);
    if (idx >= 0) this.manifest.extensions[idx] = full;
    else this.manifest.extensions.push(full);
    this.saveManifest();

    this.logger?.info(`[foundry] Wrote extension: ${def.id} (${validation.warnings.length} warnings, ${validation.securityFlags.length} flags)`);
    return { path: extDir, validation };
  }

  addTool(extensionId: string, tool: ToolDef): boolean {
    const ext = this.manifest.extensions.find(e => e.id === extensionId);
    if (!ext) return false;
    ext.tools.push(tool);
    this.writeExtension(ext);
    return true;
  }

  addHook(extensionId: string, hook: HookDef): boolean {
    const ext = this.manifest.extensions.find(e => e.id === extensionId);
    if (!ext) return false;
    ext.hooks.push(hook);
    this.writeExtension(ext);
    return true;
  }

  // ── Skill Writing ─────────────────────────────────────────────────────────

  writeSkill(def: Omit<SkillDef, "createdAt">): string {
    const full: SkillDef = { ...def, createdAt: new Date().toISOString() };
    const skillDir = join(this.skillsDir, def.name.toLowerCase().replace(/\s+/g, "-"));

    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    // Generate SKILL.md
    const endpointsDoc = def.endpoints
      .map(e => `- \`${e.method} ${e.path}\` — ${e.description}`)
      .join("\n");

    const skillMd = SKILL_TEMPLATE
      .replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{ENDPOINTS\}\}/g, endpointsDoc)
      .replace(/\{\{CLIENT_NAME\}\}/g, toPascalCase(def.name) + "Client")
      .replace(/\{\{AUTH_INFO\}\}/g, def.authHeaders ? "Auth headers stored in auth.json" : "No auth required");

    writeFileSync(join(skillDir, "SKILL.md"), skillMd);

    // Generate api.ts
    const methods = def.endpoints.map(e => {
      const methodName = toMethodName(e.method, e.path);
      const pathParams = (e.path.match(/\{(\w+)\}/g) || []).map(p => p.slice(1, -1));

      let methodCode = `  async ${methodName}(`;
      if (pathParams.length > 0) {
        methodCode += pathParams.map(p => `${p}: string`).join(", ");
      }
      if (e.method !== "GET" && e.method !== "DELETE") {
        methodCode += pathParams.length > 0 ? ", body?: any" : "body?: any";
      }
      methodCode += `) {\n`;

      let urlCode = `\`\${BASE_URL}${e.path}\``;
      for (const p of pathParams) {
        urlCode = urlCode.replace(`{${p}}`, `\${${p}}`);
      }

      methodCode += `    const url = ${urlCode};\n`;
      methodCode += `    const res = await fetch(url, {\n`;
      methodCode += `      method: "${e.method}",\n`;
      methodCode += `      headers: this.headers,\n`;
      if (e.method !== "GET" && e.method !== "DELETE") {
        methodCode += `      body: body ? JSON.stringify(body) : undefined,\n`;
      }
      methodCode += `    });\n`;
      methodCode += `    return res.json();\n`;
      methodCode += `  }\n`;

      return methodCode;
    }).join("\n");

    const apiTs = API_CLIENT_TEMPLATE
      .replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{BASE_URL\}\}/g, def.baseUrl)
      .replace(/\{\{CLIENT_NAME\}\}/g, toPascalCase(def.name) + "Client")
      .replace(/\{\{METHODS\}\}/g, methods);

    writeFileSync(join(skillDir, "api.ts"), apiTs);

    // Save auth if provided
    if (def.authHeaders) {
      writeFileSync(join(skillDir, "auth.json"), JSON.stringify({ headers: def.authHeaders }, null, 2));
    }

    const idx = this.manifest.skills.findIndex(s => s.name === def.name);
    if (idx >= 0) this.manifest.skills[idx] = full;
    else this.manifest.skills.push(full);
    this.saveManifest();

    this.logger?.info(`[foundry] Wrote skill: ${def.name}`);
    return skillDir;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getExtensions(): ExtensionDef[] {
    return this.manifest.extensions;
  }

  getSkills(): SkillDef[] {
    return this.manifest.skills;
  }

  getExtension(id: string): ExtensionDef | undefined {
    return this.manifest.extensions.find(e => e.id === id);
  }
}

// ── Learning Engine ─────────────────────────────────────────────────────────

class LearningEngine {
  private learningsPath: string;
  private pendingSessionPath: string;
  private learnings: LearningEntry[] = [];
  private pendingSession: PendingSession | null = null;

  constructor(
    private dataDir: string,
    private logger?: { info: (msg: string) => void; warn?: (msg: string) => void },
  ) {
    this.learningsPath = join(dataDir, "learnings.json");
    this.pendingSessionPath = join(dataDir, "pending-session.json");

    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.loadLearnings();
    this.loadPendingSession();
  }

  private loadLearnings(): void {
    if (existsSync(this.learningsPath)) {
      try {
        const data = JSON.parse(readFileSync(this.learningsPath, "utf-8"));
        // Ensure learnings is always an array
        this.learnings = Array.isArray(data) ? data : [];
      } catch {
        this.learnings = [];
      }
    }
  }

  private saveLearnings(): void {
    writeFileSync(this.learningsPath, JSON.stringify(this.learnings, null, 2));
  }

  private loadPendingSession(): void {
    if (existsSync(this.pendingSessionPath)) {
      try {
        this.pendingSession = JSON.parse(readFileSync(this.pendingSessionPath, "utf-8"));
        this.logger?.info(`[foundry] Found pending session from: ${this.pendingSession?.reason}`);
      } catch {
        this.pendingSession = null;
      }
    }
  }

  // ── Learning from failures ───────────────────────────────────────────────

  recordFailure(tool: string, error: string, context?: string): string {
    const id = `fail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: LearningEntry = {
      id,
      type: "failure",
      tool,
      error,
      context,
      timestamp: new Date().toISOString(),
      useCount: 0,
    };
    this.learnings.push(entry);
    this.saveLearnings();
    this.logger?.info(`[foundry] Recorded failure: ${tool} - ${error.slice(0, 50)}...`);
    return id;
  }

  recordResolution(failureId: string, resolution: string): void {
    const entry = this.learnings.find(l => l.id === failureId);
    if (entry) {
      entry.resolution = resolution;
      entry.type = "pattern"; // Upgrade to pattern once resolved
      this.saveLearnings();
      this.logger?.info(`[foundry] Recorded resolution for ${failureId}`);
    }
  }

  recordSuccess(tool: string, context: string): void {
    const entry: LearningEntry = {
      id: `success_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "success",
      tool,
      context,
      timestamp: new Date().toISOString(),
      useCount: 1,
    };
    this.learnings.push(entry);

    // Keep only last 100 success entries to avoid bloat
    const successEntries = this.learnings.filter(l => l.type === "success");
    if (successEntries.length > 100) {
      const oldest = successEntries[0];
      this.learnings = this.learnings.filter(l => l.id !== oldest.id);
    }

    this.saveLearnings();
  }

  recordInsight(insight: string, context?: string): void {
    const entry: LearningEntry = {
      id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "insight",
      context: `${insight}${context ? `\n\nContext: ${context}` : ""}`,
      timestamp: new Date().toISOString(),
      useCount: 0,
    };
    this.learnings.push(entry);
    this.saveLearnings();
    this.logger?.info(`[foundry] Recorded insight: ${insight.slice(0, 50)}...`);
  }

  // ── Query learnings ──────────────────────────────────────────────────────

  findRelevantLearnings(tool?: string, errorPattern?: string): LearningEntry[] {
    return this.learnings.filter(l => {
      if (tool && l.tool !== tool) return false;
      if (errorPattern && l.error && !l.error.includes(errorPattern)) return false;
      return l.type === "pattern" || l.type === "insight"; // Only return useful learnings
    }).slice(-10); // Last 10 relevant
  }

  getRecentFailures(limit = 5): LearningEntry[] {
    return this.learnings
      .filter(l => l.type === "failure" && !l.resolution)
      .slice(-limit);
  }

  getPatterns(): LearningEntry[] {
    return this.learnings.filter(l => l.type === "pattern");
  }

  getInsights(): LearningEntry[] {
    return this.learnings.filter(l => l.type === "insight");
  }

  getLearningsSummary(): string {
    const failures = this.learnings.filter(l => l.type === "failure").length;
    const patterns = this.learnings.filter(l => l.type === "pattern").length;
    const insights = this.learnings.filter(l => l.type === "insight").length;
    const successes = this.learnings.filter(l => l.type === "success").length;

    return `${patterns} patterns, ${insights} insights, ${failures} unresolved failures, ${successes} successes`;
  }

  // ── Pending session management ───────────────────────────────────────────

  savePendingSession(session: Omit<PendingSession, "createdAt">): void {
    this.pendingSession = {
      ...session,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(this.pendingSessionPath, JSON.stringify(this.pendingSession, null, 2));
    this.logger?.info(`[foundry] Saved pending session: ${session.reason}`);
  }

  getPendingSession(): PendingSession | null {
    return this.pendingSession;
  }

  clearPendingSession(): void {
    this.pendingSession = null;
    if (existsSync(this.pendingSessionPath)) {
      const fs = require("node:fs");
      fs.unlinkSync(this.pendingSessionPath);
    }
    this.logger?.info(`[foundry] Cleared pending session`);
  }

  hasPendingSession(): boolean {
    return this.pendingSession !== null;
  }
}

// ── Code Validator ──────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  securityFlags: string[];
}

class CodeValidator {
  private logger?: { info: (msg: string) => void; warn?: (msg: string) => void };

  constructor(logger?: { info: (msg: string) => void; warn?: (msg: string) => void }) {
    this.logger = logger;
  }

  /**
   * Validate generated code before writing.
   */
  async validate(code: string, type: "extension" | "tool" | "hook"): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const securityFlags: string[] = [];

    // 1. Basic syntax check - try to parse as function
    try {
      // Wrap in function to check syntax
      new Function(code);
    } catch (err: any) {
      errors.push(`Syntax error: ${err.message}`);
    }

    // 2. Security pattern scan (same as skill-review)
    const securityPatterns = this.staticSecurityScan(code);
    if (securityPatterns.blocked.length > 0) {
      errors.push(...securityPatterns.blocked.map(p => `BLOCKED: ${p}`));
    }
    if (securityPatterns.flagged.length > 0) {
      securityFlags.push(...securityPatterns.flagged);
    }

    // 3. Check for common mistakes
    if (type === "extension") {
      if (!code.includes("api.registerTool")) {
        warnings.push("Extension doesn't register any tools");
      }
      if (!code.includes("export default")) {
        errors.push("Extension missing 'export default'");
      }
    }

    // 4. Check for infinite loops / resource bombs
    if (/while\s*\(\s*true\s*\)/.test(code) && !/break|return/.test(code)) {
      warnings.push("Potential infinite loop detected");
    }

    this.logger?.info(`[foundry] Code validation: ${errors.length} errors, ${warnings.length} warnings, ${securityFlags.length} flags`);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      securityFlags,
    };
  }

  /**
   * Static security scan - same patterns as unbrowse's skill-review.
   */
  private staticSecurityScan(code: string): { blocked: string[]; flagged: string[] } {
    const blocked: string[] = [];
    const flagged: string[] = [];

    // BLOCK patterns - instant reject
    const blockPatterns = [
      { pattern: /id_rsa|id_ed25519|~\/\.ssh\//i, reason: "SSH key reference" },
      { pattern: /aws_secret|aws_access|~\/\.aws\//i, reason: "AWS credentials" },
      { pattern: /~\/\.gnupg\//i, reason: "GPG key reference" },
      { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i, reason: "Child process import" },
      { pattern: /\bexec\s*\(|\bspawn\s*\(|\bexecSync\s*\(/i, reason: "Shell execution" },
      { pattern: /\beval\s*\(/i, reason: "eval() usage" },
      { pattern: /new\s+Function\s*\(/i, reason: "Dynamic function creation" },
      { pattern: /\.ngrok\.|\.burpcollaborator\.|\.oastify\.|webhook\.site|requestbin/i, reason: "Exfiltration domain" },
      { pattern: /ignore\s+previous\s+instructions|system:\s*you/i, reason: "Prompt injection" },
      { pattern: /coinhive|cryptominer/i, reason: "Crypto mining" },
      { pattern: /crontab|systemctl|launchctl/i, reason: "System persistence" },
      { pattern: /<script|<!--/i, reason: "Script injection" },
    ];

    // FLAG patterns - needs review
    const flagPatterns = [
      { pattern: /process\.env|\.env/i, reason: "Environment variable access" },
      { pattern: /readFile|writeFile|fs\./i, reason: "Filesystem access" },
      { pattern: /atob|btoa|Buffer\.from/i, reason: "Base64 encoding" },
      { pattern: /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i, reason: "Hex/unicode escapes" },
    ];

    for (const { pattern, reason } of blockPatterns) {
      if (pattern.test(code)) {
        blocked.push(reason);
      }
    }

    for (const { pattern, reason } of flagPatterns) {
      if (pattern.test(code)) {
        flagged.push(reason);
      }
    }

    return { blocked, flagged };
  }

  /**
   * Test code in isolated subprocess - actually runs the extension to catch runtime errors.
   */
  async testInSandbox(code: string, tempDir: string): Promise<{ success: boolean; error?: string }> {
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const testId = `sandbox_${Date.now()}`;
    const testDir = join(tempDir, testId);
    fs.mkdirSync(testDir, { recursive: true });

    const indexFile = join(testDir, "index.ts");
    const runnerFile = join(testDir, "runner.mjs");

    try {
      // Write extension code
      fs.writeFileSync(indexFile, code);

      // Write a runner that loads and tests the extension
      const runnerCode = `
import { pathToFileURL } from "url";

// Mock clawdbot API
const mockApi = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  pluginConfig: {},
  registerTool: (tools) => {
    // Try to instantiate each tool
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (typeof tool.execute !== "function") {
          throw new Error(\`Tool \${tool.name || "unknown"} has no execute function\`);
        }
      }
    } else if (typeof tools === "function") {
      const result = tools({});
      if (Array.isArray(result)) {
        for (const tool of result) {
          if (typeof tool.execute !== "function") {
            throw new Error(\`Tool \${tool.name || "unknown"} has no execute function\`);
          }
        }
      }
    }
    return true;
  },
  on: () => {},
};

try {
  // Dynamic import of TypeScript - use tsx or ts-node
  const mod = await import(pathToFileURL("${indexFile}").href);
  const plugin = mod.default || mod;

  if (typeof plugin.register === "function") {
    plugin.register(mockApi);
  } else {
    throw new Error("Extension missing register() function");
  }

  console.log("SANDBOX_OK");
  process.exit(0);
} catch (err) {
  console.error("SANDBOX_ERROR:", err.message);
  process.exit(1);
}
`;
      fs.writeFileSync(runnerFile, runnerCode);

      // Run with tsx (TypeScript executor)
      return new Promise((resolve) => {
        const proc = spawn("npx", ["tsx", runnerFile], {
          cwd: testDir,
          timeout: 15000,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

        proc.on("close", (code: number) => {
          // Clean up
          try {
            fs.rmSync(testDir, { recursive: true, force: true });
          } catch {}

          if (code === 0 && stdout.includes("SANDBOX_OK")) {
            resolve({ success: true });
          } else {
            const errorMatch = stderr.match(/SANDBOX_ERROR:\s*(.+)/);
            const error = errorMatch?.[1] || stderr.slice(0, 500) || `Exit code ${code}`;
            resolve({ success: false, error });
          }
        });

        proc.on("error", (err: Error) => {
          try {
            fs.rmSync(testDir, { recursive: true, force: true });
          } catch {}
          resolve({ success: false, error: err.message });
        });

        // Timeout fallback
        setTimeout(() => {
          proc.kill();
          resolve({ success: false, error: "Sandbox timeout (15s)" });
        }, 15000);
      });
    } catch (err: any) {
      // Clean up on error
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {}
      return { success: false, error: err.message };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.split(/[-_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function toMethodName(method: string, path: string): string {
  const parts = path.split("/").filter(Boolean).map(p => {
    if (p.startsWith("{")) return "By" + toPascalCase(p.slice(1, -1));
    return toPascalCase(p);
  });
  return method.toLowerCase() + parts.join("");
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  id: "foundry",
  name: "Foundry",
  description: "Self-writing coding subagent — researches and implements capabilities",

  register(api: ClawdbotPluginApi) {
    const logger = api.logger;
    const cfg = api.pluginConfig || {};
    const dataDir = (cfg as any).dataDir || join(homedir(), ".clawdbot", "foundry");
    const clawdbotPath = (cfg as any).clawdbotPath || "/Users/lekt9/Projects/aiko/clawdbot";

    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const writer = new CodeWriter(dataDir, clawdbotPath, logger);
    const docsFetcher = new DocsFetcher();
    const learningEngine = new LearningEngine(dataDir, logger);
    const codeValidator = new CodeValidator(logger);

    // Track current failure for resolution matching
    let lastFailureId: string | null = null;

    // ── Tools ───────────────────────────────────────────────────────────────

    const tools = (_ctx: ClawdbotPluginToolContext) => {
      const toolList = [
        // ── foundry_research ──────────────────────────────────────────────────
        {
        name: "foundry_research",
        label: "Research Documentation",
        description:
          "Search docs.molt.bot for best practices. Use this before implementing to understand " +
          "the clawdbot API, patterns, and conventions.",
        parameters: {
          type: "object" as const,
          properties: {
            query: {
              type: "string" as const,
              description: "What to research (e.g., 'how to write hooks', 'browser automation', 'skill structure')",
            },
            topic: {
              type: "string" as const,
              enum: ["plugin", "hooks", "tools", "browser", "skills", "agent", "gateway", "channels", "memory", "models", "automation", "nodes", "security"],
              description: "Specific topic to fetch docs for (optional, faster than query)",
            },
            page: {
              type: "string" as const,
              description: "Specific doc page path (e.g., '/tools/plugin', '/automation/hooks')",
            },
          },
          required: [],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { query?: string; topic?: string; page?: string };

          let content: string;

          if (p.page) {
            content = await docsFetcher.fetchPage(p.page);
          } else if (p.topic) {
            content = await docsFetcher.fetchForTopic(p.topic);
          } else if (p.query) {
            content = await docsFetcher.search(p.query);
          } else {
            content = `## Available Documentation Topics\n\n` +
              Object.entries(DOC_PAGES).map(([topic, pages]) =>
                `- **${topic}**: ${pages.join(", ")}`
              ).join("\n") +
              `\n\nUse \`topic\` for specific docs, \`query\` for search, or \`page\` for a specific path.`;
          }

          return { content: [{ type: "text", text: content }] };
        },
      },

      // ── foundry_implement ─────────────────────────────────────────────────
      {
        name: "foundry_implement",
        label: "Implement Capability",
        description:
          "Research best practices and implement a capability. Describe what you need and this tool " +
          "will research documentation, patterns, and implement it as an extension or skill.",
        parameters: {
          type: "object" as const,
          properties: {
            capability: {
              type: "string" as const,
              description: "What capability to implement (e.g., 'OAuth token refresh', 'rate limiting', 'webhook handler')",
            },
            type: {
              type: "string" as const,
              enum: ["extension", "skill", "tool", "hook"],
              description: "What to create: extension (full plugin), skill (API client), tool (single tool), hook (event handler)",
            },
            targetExtension: {
              type: "string" as const,
              description: "For tool/hook: which extension to add it to",
            },
          },
          required: ["capability", "type"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { capability: string; type: string; targetExtension?: string };

          // Build research context - fetch from docs.molt.bot
          let context = `## Research Context\n\n`;
          context += `**Capability requested**: ${p.capability}\n`;
          context += `**Type**: ${p.type}\n\n`;
          context += `**Documentation source**: docs.molt.bot\n\n`;

          // Fetch relevant docs based on type
          try {
            const relevantTopics: string[] = [];
            if (p.type === "extension" || p.type === "tool") relevantTopics.push("plugin");
            if (p.type === "hook" || p.type === "extension") relevantTopics.push("hooks");
            if (p.type === "skill") relevantTopics.push("skills");

            // Also search for capability-specific docs
            const searchResults = await docsFetcher.search(p.capability);

            context += `### Relevant Documentation\n\n`;
            context += searchResults.slice(0, 4000) + "\n\n";

            // Also fetch specific topic docs
            for (const topic of relevantTopics) {
              const topicDocs = await docsFetcher.fetchForTopic(topic);
              context += `### ${topic.charAt(0).toUpperCase() + topic.slice(1)} API\n\n`;
              context += topicDocs.slice(0, 2000) + "\n\n";
            }
          } catch (err) {
            // Fallback to local docs if fetch fails
            const docs = writer.getDocs();
            if (docs.plugin) {
              context += `### Plugin API (local)\n\n`;
              context += docs.plugin.slice(0, 3000) + "\n\n";
            }
            if (docs.hooks) {
              context += `### Hooks API (local)\n\n`;
              context += docs.hooks.slice(0, 2000) + "\n\n";
            }
          }

          // Provide implementation guidance
          context += `## Implementation Guide\n\n`;
          context += `Based on the docs, here's how to implement "${p.capability}":\n\n`;

          switch (p.type) {
            case "extension":
              context += `Use \`foundry_write_extension\` with:\n`;
              context += `- id: kebab-case identifier\n`;
              context += `- name: Human-readable name\n`;
              context += `- description: What it does\n`;
              context += `- tools: Array of tool definitions\n`;
              context += `- hooks: Array of hook definitions\n\n`;
              context += `Each tool needs: name, label, description, properties, required, code\n`;
              context += `Each hook needs: event (before_agent_start, after_tool_call, before_tool_call, agent_end), code\n`;
              break;

            case "skill":
              context += `Use \`foundry_write_skill\` with:\n`;
              context += `- name: Skill name\n`;
              context += `- description: What it does\n`;
              context += `- baseUrl: API base URL\n`;
              context += `- endpoints: Array of { method, path, description }\n`;
              context += `- authHeaders: Optional auth headers to store\n`;
              break;

            case "tool":
              if (!p.targetExtension) {
                return { content: [{ type: "text", text: "Error: targetExtension required for type=tool" }] };
              }
              context += `Use \`foundry_add_tool\` with:\n`;
              context += `- extensionId: "${p.targetExtension}"\n`;
              context += `- name: tool_name (snake_case)\n`;
              context += `- description: What it does\n`;
              context += `- properties: Input parameters\n`;
              context += `- code: The execute function body\n`;
              break;

            case "hook":
              if (!p.targetExtension) {
                return { content: [{ type: "text", text: "Error: targetExtension required for type=hook" }] };
              }
              context += `Use \`foundry_add_hook\` with:\n`;
              context += `- extensionId: "${p.targetExtension}"\n`;
              context += `- event: One of before_agent_start, after_tool_call, before_tool_call, agent_end\n`;
              context += `- code: The handler function body (has access to event, ctx)\n`;
              break;
          }

          context += `\n## Next Steps\n\n`;
          context += `1. Review the docs above\n`;
          context += `2. Design the implementation\n`;
          context += `3. Call the appropriate foundry_write_* tool with the code\n`;

          return { content: [{ type: "text", text: context }] };
        },
      },

      // ── foundry_write_extension ───────────────────────────────────────────
      {
        name: "foundry_write_extension",
        label: "Write Extension",
        description: "Write a new clawdbot extension to ~/.clawdbot/extensions/. Restart gateway to load.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const, description: "Extension ID (kebab-case)" },
            name: { type: "string" as const, description: "Human-readable name" },
            description: { type: "string" as const, description: "What this extension does" },
            tools: {
              type: "array" as const,
              description: "Tools to include",
              items: {
                type: "object" as const,
                properties: {
                  name: { type: "string" as const },
                  label: { type: "string" as const },
                  description: { type: "string" as const },
                  properties: { type: "object" as const },
                  required: { type: "array" as const, items: { type: "string" as const } },
                  code: { type: "string" as const, description: "Execute function body" },
                },
              },
            },
            hooks: {
              type: "array" as const,
              description: "Hooks to include",
              items: {
                type: "object" as const,
                properties: {
                  event: { type: "string" as const },
                  code: { type: "string" as const },
                },
              },
            },
          },
          required: ["id", "name", "description"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;

          const tools: ToolDef[] = (p.tools || []).map((t: any) => ({
            name: t.name,
            label: t.label,
            description: t.description || "",
            properties: t.properties || {},
            required: t.required || [],
            code: t.code || "return { content: [{ type: 'text', text: 'Not implemented' }] };",
          }));

          const hooks: HookDef[] = (p.hooks || []).map((h: any) => ({
            event: h.event,
            code: h.code || "// No-op",
          }));

          try {
            const { path: extDir, validation } = await writer.writeExtension({
              id: p.id,
              name: p.name,
              description: p.description,
              tools,
              hooks,
            }, codeValidator);

            let output = `## Extension Written\n\n` +
              `**${p.name}** (\`${p.id}\`)\n\n` +
              `- Location: \`${extDir}\`\n` +
              `- Tools: ${tools.length}\n` +
              `- Hooks: ${hooks.length}\n`;

            if (validation.warnings.length > 0) {
              output += `\n**Warnings:**\n${validation.warnings.map(w => `- ${w}`).join("\n")}\n`;
            }
            if (validation.securityFlags.length > 0) {
              output += `\n**Security flags (review recommended):**\n${validation.securityFlags.map(f => `- ${f}`).join("\n")}\n`;
            }

            output += `\n**Run \`clawdbot gateway restart\` to load.**`;

            return { content: [{ type: "text", text: output }] };
          } catch (err: any) {
            return {
              content: [{
                type: "text",
                text: `## Extension BLOCKED\n\n` +
                  `**${p.name}** failed validation:\n\n` +
                  `${err.message}\n\n` +
                  `Fix the code and try again.`,
              }],
            };
          }
        },
      },

      // ── foundry_write_skill ───────────────────────────────────────────────
      {
        name: "foundry_write_skill",
        label: "Write Skill",
        description: "Write a skill package (SKILL.md + api.ts) to ~/.clawdbot/skills/",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, description: "Skill name" },
            description: { type: "string" as const, description: "What this skill does" },
            baseUrl: { type: "string" as const, description: "API base URL" },
            endpoints: {
              type: "array" as const,
              description: "API endpoints",
              items: {
                type: "object" as const,
                properties: {
                  method: { type: "string" as const, enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
                  path: { type: "string" as const, description: "Path with {param} placeholders" },
                  description: { type: "string" as const },
                },
              },
            },
            authHeaders: {
              type: "object" as const,
              description: "Auth headers to store (optional)",
            },
          },
          required: ["name", "description", "baseUrl", "endpoints"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;

          const skillDir = writer.writeSkill({
            name: p.name,
            description: p.description,
            baseUrl: p.baseUrl,
            endpoints: p.endpoints || [],
            authHeaders: p.authHeaders,
          });

          return {
            content: [{
              type: "text",
              text: `## Skill Written\n\n` +
                `**${p.name}**\n\n` +
                `- Location: \`${skillDir}\`\n` +
                `- Base URL: \`${p.baseUrl}\`\n` +
                `- Endpoints: ${(p.endpoints || []).length}\n` +
                `- Auth: ${p.authHeaders ? "stored" : "none"}\n\n` +
                `Skill is ready to use with unbrowse_replay.`,
            }],
          };
        },
      },

      // ── foundry_add_tool ──────────────────────────────────────────────────
      {
        name: "foundry_add_tool",
        label: "Add Tool",
        description: "Add a new tool to an existing extension",
        parameters: {
          type: "object" as const,
          properties: {
            extensionId: { type: "string" as const, description: "Extension to add tool to" },
            name: { type: "string" as const, description: "Tool name (snake_case)" },
            label: { type: "string" as const, description: "Display label" },
            description: { type: "string" as const, description: "What the tool does" },
            properties: { type: "object" as const, description: "Input properties" },
            required: { type: "array" as const, items: { type: "string" as const } },
            code: { type: "string" as const, description: "Execute function body" },
          },
          required: ["extensionId", "name", "description", "code"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;

          const success = writer.addTool(p.extensionId, {
            name: p.name,
            label: p.label,
            description: p.description,
            properties: p.properties || {},
            required: p.required || [],
            code: p.code,
          });

          if (!success) {
            return { content: [{ type: "text", text: `Extension "${p.extensionId}" not found.` }] };
          }

          return {
            content: [{
              type: "text",
              text: `Added tool **${p.name}** to **${p.extensionId}**.\n\nRestart gateway to load.`,
            }],
          };
        },
      },

      // ── foundry_add_hook ──────────────────────────────────────────────────
      {
        name: "foundry_add_hook",
        label: "Add Hook",
        description: "Add a new hook to an existing extension",
        parameters: {
          type: "object" as const,
          properties: {
            extensionId: { type: "string" as const, description: "Extension to add hook to" },
            event: {
              type: "string" as const,
              enum: ["before_agent_start", "after_tool_call", "before_tool_call", "agent_end"],
              description: "Hook event",
            },
            code: { type: "string" as const, description: "Handler function body" },
          },
          required: ["extensionId", "event", "code"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;

          const success = writer.addHook(p.extensionId, {
            event: p.event,
            code: p.code,
          });

          if (!success) {
            return { content: [{ type: "text", text: `Extension "${p.extensionId}" not found.` }] };
          }

          return {
            content: [{
              type: "text",
              text: `Added **${p.event}** hook to **${p.extensionId}**.\n\nRestart gateway to load.`,
            }],
          };
        },
      },

      // ── foundry_list ──────────────────────────────────────────────────────
      {
        name: "foundry_list",
        label: "List Written Code",
        description: "List all extensions and skills written by foundry",
        parameters: {
          type: "object" as const,
          properties: {
            showCode: { type: "boolean" as const, description: "Show generated code" },
          },
          required: [] as string[],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { showCode?: boolean };
          const extensions = writer.getExtensions();
          const skills = writer.getSkills();

          let output = `## Foundry: Written Code\n\n`;

          output += `### Extensions (${extensions.length})\n\n`;
          for (const ext of extensions) {
            output += `**${ext.name}** (\`${ext.id}\`)\n`;
            output += `- Tools: ${ext.tools.map(t => t.name).join(", ") || "none"}\n`;
            output += `- Hooks: ${ext.hooks.map(h => h.event).join(", ") || "none"}\n`;
            output += `- Created: ${ext.createdAt}\n\n`;

            if (p.showCode) {
              const codePath = join(homedir(), ".clawdbot", "extensions", ext.id, "index.ts");
              if (existsSync(codePath)) {
                output += "```typescript\n" + readFileSync(codePath, "utf-8").slice(0, 2000) + "\n```\n\n";
              }
            }
          }

          output += `### Skills (${skills.length})\n\n`;
          for (const skill of skills) {
            output += `**${skill.name}**\n`;
            output += `- Base URL: \`${skill.baseUrl}\`\n`;
            output += `- Endpoints: ${skill.endpoints.length}\n`;
            output += `- Created: ${skill.createdAt}\n\n`;
          }

          if (extensions.length === 0 && skills.length === 0) {
            output += "No code written yet. Use `foundry_implement` to get started.\n";
          }

          return { content: [{ type: "text", text: output }] };
        },
      },

      // ── foundry_docs ──────────────────────────────────────────────────────
      {
        name: "foundry_docs",
        label: "Read Clawdbot Docs",
        description: "Read clawdbot plugin/hooks documentation for writing extensions",
        parameters: {
          type: "object" as const,
          properties: {
            section: {
              type: "string" as const,
              enum: ["plugin", "hooks", "both"],
              description: "Which docs to show",
            },
          },
          required: [] as string[],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { section?: string };
          const docs = writer.getDocs();
          const section = p.section || "both";

          let output = `## Clawdbot Extension Docs\n\n`;

          if (!docs.plugin && !docs.hooks) {
            return { content: [{ type: "text", text: "Could not load clawdbot docs. Check clawdbotPath config." }] };
          }

          if (section === "plugin" || section === "both") {
            output += `### Plugin API\n\n`;
            output += docs.plugin ? docs.plugin.slice(0, 8000) + "\n\n[truncated]\n\n" : "Not loaded\n\n";
          }

          if (section === "hooks" || section === "both") {
            output += `### Hooks API\n\n`;
            output += docs.hooks ? docs.hooks.slice(0, 5000) + "\n\n[truncated]\n\n" : "Not loaded\n\n";
          }

          return { content: [{ type: "text", text: output }] };
        },
      },

      // ── foundry_extend_self ───────────────────────────────────────────────
      {
        name: "foundry_extend_self",
        label: "Extend Self",
        description:
          "Write new code into the foundry extension itself. Add new tools or modify existing ones. " +
          "This is true self-modification — the extension rewrites its own source code.",
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string" as const,
              enum: ["add_tool", "add_code", "read_self"],
              description: "What to do: add_tool (add a new tool), add_code (inject code), read_self (view current source)",
            },
            toolName: {
              type: "string" as const,
              description: "For add_tool: name of the new tool (snake_case)",
            },
            toolLabel: {
              type: "string" as const,
              description: "For add_tool: display label",
            },
            toolDescription: {
              type: "string" as const,
              description: "For add_tool: what the tool does",
            },
            toolParameters: {
              type: "object" as const,
              description: "For add_tool: parameter schema",
            },
            toolCode: {
              type: "string" as const,
              description: "For add_tool/add_code: the code to add",
            },
            insertAfter: {
              type: "string" as const,
              description: "For add_code: marker text to insert after",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;
          const selfPath = join(__dirname, "index.ts");

          // Check if we can find ourselves
          if (!existsSync(selfPath)) {
            // Try alternate path
            const altPath = "/Users/lekt9/Projects/aiko/extensions/foundry/index.ts";
            if (!existsSync(altPath)) {
              return { content: [{ type: "text", text: `Cannot find self at ${selfPath} or ${altPath}` }] };
            }
          }

          const actualPath = existsSync(selfPath) ? selfPath : "/Users/lekt9/Projects/aiko/extensions/foundry/index.ts";

          if (p.action === "read_self") {
            const content = readFileSync(actualPath, "utf-8");
            return { content: [{ type: "text", text: `## Self Source (${actualPath})\n\n\`\`\`typescript\n${content.slice(0, 10000)}\n\`\`\`\n\n[${content.length} chars total]` }] };
          }

          if (p.action === "add_tool") {
            if (!p.toolName || !p.toolDescription || !p.toolCode) {
              return { content: [{ type: "text", text: "Missing required: toolName, toolDescription, toolCode" }] };
            }

            let content = readFileSync(actualPath, "utf-8");

            // Build the new tool
            const newTool = `
      // ── ${p.toolName} (self-written) ─────────────────────────────────────
      {
        name: "${p.toolName}",
        label: "${p.toolLabel || p.toolName}",
        description: "${p.toolDescription.replace(/"/g, '\\"')}",
        parameters: ${JSON.stringify(p.toolParameters || { type: "object", properties: {}, required: [] }, null, 10).replace(/^/gm, "        ").trim()},
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;
${p.toolCode.split("\n").map((l: string) => "          " + l).join("\n")}
        },
      },`;

            // Find the end of the tools array (before the closing ];)
            const toolsArrayEnd = content.lastIndexOf("    ];\n\n    const toolNames = [");
            if (toolsArrayEnd === -1) {
              return { content: [{ type: "text", text: "Could not find tools array end marker" }] };
            }

            // Insert the new tool before the ];
            content = content.slice(0, toolsArrayEnd) + newTool + "\n" + content.slice(toolsArrayEnd);

            // Also add to toolNames
            const toolNamesMatch = content.match(/const toolNames = \[\n([\s\S]*?)\n    \];/);
            if (toolNamesMatch) {
              const oldToolNames = toolNamesMatch[0];
              const newToolNames = oldToolNames.replace(
                /\n    \];/,
                `\n      "${p.toolName}",\n    ];`
              );
              content = content.replace(oldToolNames, newToolNames);
            }

            writeFileSync(actualPath, content);

            return {
              content: [{
                type: "text",
                text: `## Self-Modified\n\n` +
                  `Added tool **${p.toolName}** to foundry extension.\n\n` +
                  `- Location: ${actualPath}\n` +
                  `- Lines added: ~${newTool.split("\n").length}\n\n` +
                  `**Restart gateway to load the new tool.**`,
              }],
            };
          }

          if (p.action === "add_code") {
            if (!p.toolCode || !p.insertAfter) {
              return { content: [{ type: "text", text: "Missing required: toolCode, insertAfter" }] };
            }

            let content = readFileSync(actualPath, "utf-8");
            const insertPos = content.indexOf(p.insertAfter);

            if (insertPos === -1) {
              return { content: [{ type: "text", text: `Could not find marker: "${p.insertAfter.slice(0, 50)}..."` }] };
            }

            content = content.slice(0, insertPos + p.insertAfter.length) + "\n" + p.toolCode + content.slice(insertPos + p.insertAfter.length);
            writeFileSync(actualPath, content);

            return {
              content: [{
                type: "text",
                text: `## Self-Modified\n\n` +
                  `Inserted code after marker.\n\n` +
                  `**Restart gateway to load changes.**`,
              }],
            };
          }

          return { content: [{ type: "text", text: `Unknown action: ${p.action}` }] };
        },
      },

      // ── foundry_restart ────────────────────────────────────────────────────
      {
        name: "foundry_restart",
        label: "Restart with Resume",
        description:
          "Restart the gateway to load new code, while saving the current conversation context " +
          "so the agent can automatically resume after restart. Use this after writing new extensions.",
        parameters: {
          type: "object" as const,
          properties: {
            reason: {
              type: "string" as const,
              description: "Why we're restarting (e.g., 'load new oauth-refresh extension')",
            },
            resumeContext: {
              type: "string" as const,
              description: "Context to resume with after restart (what we were doing)",
            },
            lastMessage: {
              type: "string" as const,
              description: "The user's last message/request to continue after restart",
            },
          },
          required: ["reason", "resumeContext"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { reason: string; resumeContext: string; lastMessage?: string };
          const { exec } = require("node:child_process");

          // Save pending session for resume
          learningEngine.savePendingSession({
            agentId: "current", // Will be replaced with actual ID if available
            lastMessage: p.lastMessage || "Continue from where we left off",
            context: p.resumeContext,
            reason: p.reason,
          });

          // Schedule restart after returning
          setTimeout(() => {
            exec("clawdbot gateway restart", (error: any) => {
              if (error) {
                logger.error?.(`[foundry] Restart failed: ${error.message}`);
              }
            });
          }, 500);

          return {
            content: [{
              type: "text",
              text: `## Gateway Restart Scheduled\n\n` +
                `**Reason**: ${p.reason}\n\n` +
                `Session context saved. The conversation will automatically resume after restart.\n\n` +
                `Restarting in 500ms...`,
            }],
          };
        },
      },

      // ── foundry_learnings ──────────────────────────────────────────────────
      {
        name: "foundry_learnings",
        label: "View Learnings",
        description: "View what foundry has learned from successes, failures, and patterns",
        parameters: {
          type: "object" as const,
          properties: {
            type: {
              type: "string" as const,
              enum: ["all", "patterns", "failures", "insights"],
              description: "What type of learnings to show",
            },
            tool: {
              type: "string" as const,
              description: "Filter by tool name",
            },
          },
          required: [] as string[],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { type?: string; tool?: string };
          const filterType = p.type || "all";

          let entries: LearningEntry[] = [];
          if (filterType === "patterns") entries = learningEngine.getPatterns();
          else if (filterType === "failures") entries = learningEngine.getRecentFailures(10);
          else if (filterType === "insights") entries = learningEngine.getInsights();
          else entries = learningEngine.findRelevantLearnings(p.tool);

          let output = `## Foundry: Learnings\n\n`;
          output += `**Summary**: ${learningEngine.getLearningsSummary()}\n\n`;

          if (entries.length === 0) {
            output += "No learnings found for this filter.\n";
          } else {
            for (const entry of entries) {
              output += `### ${entry.type.toUpperCase()}: ${entry.tool || "general"}\n`;
              if (entry.error) output += `- **Error**: ${entry.error.slice(0, 100)}...\n`;
              if (entry.resolution) output += `- **Resolution**: ${entry.resolution}\n`;
              if (entry.context) output += `- **Context**: ${entry.context.slice(0, 200)}...\n`;
              output += `- **When**: ${entry.timestamp}\n\n`;
            }
          }

          return { content: [{ type: "text", text: output }] };
        },
      },
      // ── foundry_publish_ability ─────────────────────────────────────────
      {
        name: "foundry_publish_ability",
        label: "Publish to Brain Marketplace",
        description:
          "Publish a pattern, extension, technique, insight, or agent design to the brain marketplace. " +
          "Patterns are free to share (crowdsourced learning), other abilities earn USDC. " +
          "Requires a creator wallet (set up via unbrowse_wallet).",
        parameters: {
          type: "object" as const,
          properties: {
            type: {
              type: "string" as const,
              enum: ["pattern", "extension", "technique", "insight", "agent"],
              description: "Type of ability to publish",
            },
            name: {
              type: "string" as const,
              description: "Name/title for the ability",
            },
            description: {
              type: "string" as const,
              description: "Description of what this ability does",
            },
            content: {
              type: "object" as const,
              description: "The ability content (varies by type)",
            },
            patternId: {
              type: "string" as const,
              description: "ID of an existing pattern to publish (for type=pattern)",
            },
          },
          required: ["type", "name"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as {
            type: string;
            name: string;
            description?: string;
            content?: any;
            patternId?: string;
          };

          // Get creator wallet from config
          const configPath = join(homedir(), ".clawdbot", "clawdbot.json");
          let creatorWallet: string | null = null;
          try {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            creatorWallet = config?.plugins?.entries?.unbrowse?.config?.creatorWallet;
          } catch {}

          if (!creatorWallet) {
            return {
              content: [{
                type: "text",
                text: "No creator wallet configured. Use unbrowse_wallet to set up a wallet first.",
              }],
            };
          }

          // Get skill index URL from config
          let skillIndexUrl = "https://skills.molt.bot";
          try {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            skillIndexUrl = config?.plugins?.entries?.unbrowse?.config?.skillIndexUrl ?? skillIndexUrl;
          } catch {}

          let content = p.content;

          // For patterns, look up from learnings
          if (p.type === "pattern" && p.patternId) {
            const patterns = learningEngine.getPatterns();
            const pattern = patterns.find(pat => pat.id === p.patternId);
            if (!pattern) {
              return { content: [{ type: "text", text: `Pattern not found: ${p.patternId}` }] };
            }
            content = {
              errorPattern: pattern.error || "",
              resolution: pattern.resolution || "",
              tool: pattern.tool,
              context: pattern.context,
              useCount: pattern.useCount || 1,
            };
          }

          if (!content) {
            return { content: [{ type: "text", text: "Provide content or patternId for the ability." }] };
          }

          try {
            const resp = await fetch(`${skillIndexUrl}/skills/publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                abilityType: p.type,
                service: p.name,
                content,
                creatorWallet,
                baseUrl: "",
                authMethodType: "none",
                endpoints: [],
                skillMd: p.description || "",
                apiTemplate: "",
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!resp.ok) {
              const text = await resp.text();
              return { content: [{ type: "text", text: `Publish failed: ${text}` }] };
            }

            const result = await resp.json() as { id: string; slug: string; version: number; reviewStatus: string };

            return {
              content: [{
                type: "text",
                text: [
                  `Published ${p.type}: ${p.name}`,
                  ``,
                  `ID: ${result.id}`,
                  `Version: ${result.version}`,
                  `Status: ${result.reviewStatus}`,
                  ``,
                  p.type === "pattern"
                    ? "Patterns are free to share — thanks for contributing to the brain!"
                    : `Others can download this ${p.type} via foundry_marketplace. You earn USDC per download.`,
                ].join("\n"),
              }],
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Publish error: ${(err as Error).message}` }] };
          }
        },
      },

      // ── Foundry Marketplace Tool ───────────────────────────────────────────
      // Search and install abilities from the crowdsourced marketplace
      {
        name: "foundry_marketplace",
        label: "Foundry Marketplace",
        description:
          "Search and install abilities from the Foundry marketplace. " +
          "Abilities include skills (APIs), patterns (failure resolutions), extensions (plugins), " +
          "techniques (code snippets), insights (approaches), and agent designs. " +
          "Use action='search' with query, action='leaderboard' to see top abilities, " +
          "or action='install' with id to download (costs vary by type).",
        parameters: {
          type: "object" as const,
          properties: {
            action: {
              type: "string" as const,
              enum: ["search", "leaderboard", "install"],
              description: "Action to perform",
            },
            query: {
              type: "string" as const,
              description: "Search query (for action='search')",
            },
            type: {
              type: "string" as const,
              enum: ["skill", "pattern", "extension", "technique", "insight", "agent"],
              description: "Filter by ability type",
            },
            id: {
              type: "string" as const,
              description: "Ability ID to install (for action='install')",
            },
            limit: {
              type: "number" as const,
              description: "Number of results (default: 10)",
            },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: unknown) {
          const p = params as { action: string; query?: string; type?: string; id?: string; limit?: number };

          // Get config for marketplace
          const configPath = join(homedir(), ".clawdbot", "clawdbot.json");
          let skillIndexUrl = "https://skills.molt.bot";
          let solanaPrivateKey: string | undefined;
          try {
            const config = JSON.parse(readFileSync(configPath, "utf-8"));
            skillIndexUrl = config?.plugins?.entries?.unbrowse?.config?.skillIndexUrl ?? skillIndexUrl;
            const walletPath = config?.plugins?.entries?.unbrowse?.config?.solanaWalletPath;
            if (walletPath && existsSync(walletPath)) {
              const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
              solanaPrivateKey = walletData.privateKey;
            }
          } catch {}

          // Lazy-load brain client
          const { BrainIndexClient } = await import("./src/brain-index.js");
          const brainClient = new BrainIndexClient({ indexUrl: skillIndexUrl, solanaPrivateKey });

          try {
            if (p.action === "leaderboard") {
              const result = await brainClient.getLeaderboard({
                type: p.type as any,
                limit: p.limit ?? 20,
              });

              if (result.abilities.length === 0) {
                return { content: [{ type: "text", text: "No abilities in leaderboard yet. Be the first to publish!" }] };
              }

              const lines = [
                `## Foundry Marketplace Leaderboard`,
                ``,
                `Showing top ${result.abilities.length} abilities by rank score:`,
                ``,
              ];

              for (const ability of result.abilities) {
                const price = ability.priceCents === 0 ? "FREE" : `$${(ability.priceCents / 100).toFixed(2)}`;
                lines.push(
                  `**${ability.service}** (${ability.abilityType})`,
                  `  ID: ${ability.id} | Payers: ${ability.uniquePayers} | Score: ${ability.rankScore} | ${price}`,
                  ``,
                );
              }

              lines.push(`Use foundry_marketplace with action="install" and id="<id>" to download.`);
              return { content: [{ type: "text", text: lines.join("\n") }] };
            }

            if (p.action === "search") {
              if (!p.query) {
                return { content: [{ type: "text", text: "Provide a query for search." }] };
              }

              const result = await brainClient.searchAbilities(p.query, {
                type: p.type as any,
                limit: p.limit ?? 10,
              });

              if (result.skills.length === 0) {
                return { content: [{ type: "text", text: `No abilities found for: ${p.query}` }] };
              }

              const lines = [
                `## Search Results: "${p.query}"`,
                ``,
                `Found ${result.total} abilities:`,
                ``,
              ];

              for (const ability of result.skills) {
                const price = ability.priceCents === 0 ? "FREE" : `$${(ability.priceCents / 100).toFixed(2)}`;
                lines.push(
                  `**${ability.service}** (${ability.abilityType})`,
                  `  ID: ${ability.id} | Downloads: ${ability.downloadCount} | ${price}`,
                  ``,
                );
              }

              lines.push(`Use foundry_marketplace with action="install" and id="<id>" to download.`);
              return { content: [{ type: "text", text: lines.join("\n") }] };
            }

            if (p.action === "install") {
              if (!p.id) {
                return { content: [{ type: "text", text: "Provide an id to install." }] };
              }

              const ability = await brainClient.downloadAbility(p.id);

              // Handle different ability types
              const abilityType = (ability as any).abilityType || (ability as any).type || "skill";

              if (abilityType === "pattern") {
                // Record pattern in learning engine
                const content = (ability as any).content;
                if (content?.errorPattern && content?.resolution) {
                  const patternId = learningEngine.recordFailure("imported", content.errorPattern, content.context);
                  learningEngine.recordResolution(patternId, content.resolution);
                  return {
                    content: [{
                      type: "text",
                      text: [
                        `Installed pattern: ${(ability as any).service}`,
                        ``,
                        `Error: ${content.errorPattern}`,
                        `Resolution: ${content.resolution}`,
                        ``,
                        `Pattern recorded — will be suggested when similar errors occur.`,
                      ].join("\n"),
                    }],
                  };
                }
              }

              if (abilityType === "extension") {
                // Write extension to extensions directory
                const content = (ability as any).content;
                if (content?.code) {
                  const extId = (ability as any).service?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "imported-ext";
                  const result = await writer.writeExtension({
                    id: extId,
                    name: (ability as any).service,
                    description: content.description || "",
                    tools: [],
                    hooks: [],
                  });

                  return {
                    content: [{
                      type: "text",
                      text: [
                        `Installed extension: ${(ability as any).service}`,
                        ``,
                        `Path: ${result.path}`,
                        ``,
                        `Run foundry_restart to load the new extension.`,
                      ].join("\n"),
                    }],
                  };
                }
              }

              // Default: return raw ability info
              return {
                content: [{
                  type: "text",
                  text: [
                    `Downloaded: ${(ability as any).service || p.id}`,
                    `Type: ${abilityType}`,
                    ``,
                    `Content:`,
                    JSON.stringify((ability as any).content || ability, null, 2).slice(0, 2000),
                  ].join("\n"),
                }],
              };
            }

            return { content: [{ type: "text", text: `Unknown action: ${p.action}. Use search, leaderboard, or install.` }] };
          } catch (err) {
            return { content: [{ type: "text", text: `Marketplace error: ${(err as Error).message}` }] };
          }
        },
      },
      ];

      return toolList;
    };

    const toolNames = [
      "foundry_research",
      "foundry_implement",
      "foundry_write_extension",
      "foundry_write_skill",
      "foundry_add_tool",
      "foundry_add_hook",
      "foundry_list",
      "foundry_docs",
      "foundry_extend_self",
      "foundry_restart",
      "foundry_learnings",
      "foundry_publish_ability",
      "foundry_marketplace",
    ];

    api.registerTool(tools, { names: toolNames });

    // ── before_agent_start Hook ─────────────────────────────────────────────
    // Check for pending session (resume after restart) and inject learnings
    api.on("before_agent_start", async (event: any, ctx: any) => {
      const extensions = writer.getExtensions();
      const skills = writer.getSkills();
      const pendingSession = learningEngine.getPendingSession();

      let resumeContext = "";
      if (pendingSession) {
        resumeContext = `
## ⚡ RESUMED SESSION

**Gateway restarted**: ${pendingSession.reason}

**Previous context**: ${pendingSession.context}

**Continue with**: ${pendingSession.lastMessage}

---

`;
        // Clear the pending session after injecting
        learningEngine.clearPendingSession();
        logger.info(`[foundry] Resumed session: ${pendingSession.reason}`);
      }

      // Include relevant learnings if we have patterns
      const patterns = learningEngine.getPatterns().slice(-3);
      const insights = learningEngine.getInsights().slice(-2);
      let learningsContext = "";

      if (patterns.length > 0 || insights.length > 0) {
        learningsContext = `
## Learned Patterns

${patterns.map(p => `- **${p.tool}**: ${p.error?.slice(0, 50)}... → ${p.resolution?.slice(0, 100)}`).join("\n")}
${insights.map(i => `- **Insight**: ${i.context?.slice(0, 100)}`).join("\n")}

`;
      }

      return {
        prependContext: `${resumeContext}${learningsContext}
## Foundry: Self-Writing Coding Subagent

Grounded in **docs.molt.bot** — fetches documentation on demand. Can modify its own source code.

**Written**: ${extensions.length} extensions, ${skills.length} skills | **Learnings**: ${learningEngine.getLearningsSummary()}

**Tools**:
- \`foundry_research\` — Search docs.molt.bot for best practices
- \`foundry_implement\` — Research + implement a capability (fetches docs)
- \`foundry_write_extension\` — Create a clawdbot extension
- \`foundry_write_skill\` — Create a skill package
- \`foundry_extend_self\` — **Write new tools into foundry itself**
- \`foundry_restart\` — Restart gateway and resume conversation

When you need a new capability:
1. \`foundry_research\` — understand the API
2. \`foundry_implement\` — get implementation guidance
3. \`foundry_write_*\` or \`foundry_extend_self\` — write the code
4. \`foundry_restart\` — restart gateway to load, auto-resumes
`,
      };
    });

    // ── after_tool_call Hook ─────────────────────────────────────────────────
    // Proactively learn from tool failures and successes
    api.on("after_tool_call", async (event: any, ctx: any) => {
      const { toolName, result, error } = event;

      // Skip our own tools to avoid recursive learning
      if (toolName?.startsWith("foundry_")) return;

      // Learn from failures
      if (error || (result && typeof result === "object" && (result as any).error)) {
        const errorMsg = error || (result as any).error || "Unknown error";
        lastFailureId = learningEngine.recordFailure(
          toolName || "unknown",
          typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg),
          ctx?.lastUserMessage?.slice(0, 200)
        );

        // Check if we have a pattern for this
        const relevant = learningEngine.findRelevantLearnings(toolName);
        if (relevant.length > 0) {
          logger.info(`[foundry] Found ${relevant.length} relevant patterns for ${toolName} failure`);
        }
      } else {
        // Record success for frequently used tools
        if (lastFailureId && toolName) {
          // If we just had a failure and now succeeded, record the resolution
          learningEngine.recordResolution(lastFailureId, `Succeeded with ${toolName}`);
          lastFailureId = null;
        }
      }
    });

    // ── agent_end Hook ───────────────────────────────────────────────────────
    // Learn from completed sessions
    api.on("agent_end", async (event: any, ctx: any) => {
      const { outcome, toolsUsed } = event;

      if (outcome === "success" && toolsUsed?.length > 2) {
        // Record successful tool combinations
        const combo = toolsUsed.slice(0, 5).join(" → ");
        learningEngine.recordInsight(
          `Successful tool sequence: ${combo}`,
          ctx?.summary?.slice(0, 200)
        );
      }

      // Clear any pending failure tracking
      lastFailureId = null;
    });

    const features = [
      `${toolNames.length} tools`,
      "docs.molt.bot grounded",
      "self-modification",
      "proactive learning",
      "restart resume",
    ].join(", ");
    logger.info(`[foundry] Plugin registered (${features})`);
    logger.info(`[foundry] Written: ${writer.getExtensions().length} extensions, ${writer.getSkills().length} skills`);
    logger.info(`[foundry] Learnings: ${learningEngine.getLearningsSummary()}`);

    // Check for pending session on startup
    if (learningEngine.hasPendingSession()) {
      const pending = learningEngine.getPendingSession();
      logger.info(`[foundry] ⚡ Pending session found: ${pending?.reason}`);
    }
  },
};
