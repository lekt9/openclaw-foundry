/**
 * Foundry — Self-writing coding subagent for OpenClaw.
 *
 * A meta-extension that researches best practices and writes code into:
 * - OpenClaw extensions (tools, hooks)
 * - Skills (SKILL.md + api.ts)
 * - The extension itself
 *
 * Grounded in docs.molt.bot/llms.txt — fetches documentation on demand.
 *
 * Tools:
 *   foundry_research     — Search docs.molt.bot for best practices
 *   foundry_implement    — Research + implement a capability
 *   foundry_write_extension — Write a new OpenClaw extension
 *   foundry_write_skill  — Write a skill package
 *   foundry_add_tool     — Add a tool to an existing extension
 *   foundry_add_hook     — Add a hook to an existing extension
 *   foundry_list         — List written extensions/skills
 *   foundry_docs         — Read OpenClaw plugin/hooks documentation
 */

import type {
  ClawdbotPluginApi,
  ClawdbotPluginToolContext,
} from "clawdbot/plugin-sdk";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Documentation URLs ───────────────────────────────────────────────────────

// Primary: OpenClaw documentation (AgentSkills-compatible)
const OPENCLAW_DOCS_BASE = "https://docs.openclaw.ai";
const OPENCLAW_LLMS_TXT = `${OPENCLAW_DOCS_BASE}/llms.txt`;

// Fallback: molt.bot documentation
const DOCS_BASE = "https://docs.molt.bot";
const LLMS_TXT = `${DOCS_BASE}/llms.txt`;

// Key documentation pages for different capabilities
// Prioritizes OpenClaw docs for skills, falls back to molt.bot for other topics
const DOC_PAGES: Record<string, string[]> = {
  // OpenClaw primary docs (skills, plugins, clawdhub)
  skills: ["/tools/skills", "/tools/skills-config", "/tools/clawdhub"],
  plugin: ["/plugin", "/tools/plugin"],
  clawdhub: ["/tools/clawdhub"],
  // Gateway and infrastructure
  hooks: ["/automation/hooks"],
  tools: ["/tools/tools", "/tools/lobster", "/tools/exec"],
  browser: ["/tools/browser", "/tools/browser-login"],
  agent: ["/concepts/agent", "/concepts/agent-loop", "/concepts/system-prompt"],
  gateway: ["/gateway/gateway", "/gateway/configuration", "/gateway/protocol"],
  channels: [
    "/channels/index",
    "/channels/whatsapp",
    "/channels/telegram",
    "/channels/discord",
  ],
  memory: ["/concepts/memory", "/cli/memory"],
  models: ["/concepts/models", "/concepts/model-providers"],
  automation: [
    "/automation/hooks",
    "/automation/cron-jobs",
    "/automation/webhook",
  ],
  nodes: ["/nodes/nodes", "/nodes/camera"],
  security: ["/gateway/security", "/gateway/sandboxing"],
};

// ── Documentation Fetcher ────────────────────────────────────────────────────

// Topics that should use OpenClaw docs as primary source
const OPENCLAW_TOPICS = new Set(["skills", "plugin", "clawdhub"]);

class DocsFetcher {
  private cache: Map<string, { content: string; fetchedAt: number }> =
    new Map();
  private cacheTtl = 1000 * 60 * 30; // 30 minutes
  private openclawIndex: string | null = null;

  /**
   * Fetch the OpenClaw llms.txt index for discovering available documentation pages.
   * This should be called first to understand what docs are available.
   */
  async fetchOpenClawIndex(): Promise<string> {
    if (this.openclawIndex) return this.openclawIndex;

    try {
      const res = await fetch(OPENCLAW_LLMS_TXT);
      if (res.ok) {
        this.openclawIndex = await res.text();
        this.cache.set(OPENCLAW_LLMS_TXT, {
          content: this.openclawIndex,
          fetchedAt: Date.now(),
        });
        return this.openclawIndex;
      }
    } catch (err) {
      // Fallback silently
    }
    return "OpenClaw llms.txt not available. Using fallback documentation.";
  }

  /**
   * Get the base URL for a topic - OpenClaw for skills/plugins, molt.bot for others
   */
  private getBaseUrl(topic: string): string {
    return OPENCLAW_TOPICS.has(topic.toLowerCase())
      ? OPENCLAW_DOCS_BASE
      : DOCS_BASE;
  }

  async fetchPage(path: string, preferOpenClaw = false): Promise<string> {
    // Determine base URL
    let baseUrl = DOCS_BASE;
    if (
      preferOpenClaw ||
      path.includes("/skills") ||
      path.includes("/plugin") ||
      path.includes("/clawdhub")
    ) {
      baseUrl = OPENCLAW_DOCS_BASE;
    }

    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

    // Check cache
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtl) {
      return cached.content;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        // If OpenClaw fails, try molt.bot as fallback
        if (baseUrl === OPENCLAW_DOCS_BASE) {
          const fallbackUrl = `${DOCS_BASE}${path}`;
          const fallbackRes = await fetch(fallbackUrl);
          if (fallbackRes.ok) {
            const html = await fallbackRes.text();
            const content = this.extractContent(html);
            this.cache.set(fallbackUrl, { content, fetchedAt: Date.now() });
            return content;
          }
        }
        return `Failed to fetch ${url}: ${res.status}`;
      }

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
      const matchingTopic = Object.keys(DOC_PAGES).find(
        (k) =>
          k.includes(topic.toLowerCase()) || topic.toLowerCase().includes(k),
      );
      if (matchingTopic) {
        return this.fetchForTopic(matchingTopic);
      }
      return `No documentation pages mapped for topic: ${topic}. Available topics: ${Object.keys(DOC_PAGES).join(", ")}`;
    }

    // For skills topics, always fetch OpenClaw index first for context
    if (OPENCLAW_TOPICS.has(topic.toLowerCase())) {
      await this.fetchOpenClawIndex();
    }

    const preferOpenClaw = OPENCLAW_TOPICS.has(topic.toLowerCase());
    const results: string[] = [];
    for (const page of pages.slice(0, 2)) {
      // Limit to 2 pages to avoid too much content
      const content = await this.fetchPage(page, preferOpenClaw);
      const baseUrl = preferOpenClaw ? OPENCLAW_DOCS_BASE : DOCS_BASE;
      results.push(`## ${baseUrl}${page}\n\n${content.slice(0, 4000)}`);
    }
    return results.join("\n\n---\n\n");
  }

  async search(query: string): Promise<string> {
    // Find relevant topics based on query keywords
    const queryLower = query.toLowerCase();
    const relevantTopics: string[] = [];

    for (const [topic, pages] of Object.entries(DOC_PAGES)) {
      if (
        queryLower.includes(topic) ||
        topic.includes(queryLower.split(" ")[0])
      ) {
        relevantTopics.push(topic);
      }
    }

    // Check for specific keywords
    if (queryLower.includes("hook") || queryLower.includes("event"))
      relevantTopics.push("hooks");
    if (queryLower.includes("tool") || queryLower.includes("plugin"))
      relevantTopics.push("plugin", "tools");
    if (queryLower.includes("browser") || queryLower.includes("playwright"))
      relevantTopics.push("browser");
    if (
      queryLower.includes("skill") ||
      queryLower.includes("api") ||
      queryLower.includes("agentskill")
    )
      relevantTopics.push("skills");
    if (queryLower.includes("agent") || queryLower.includes("prompt"))
      relevantTopics.push("agent");
    if (queryLower.includes("channel") || queryLower.includes("message"))
      relevantTopics.push("channels");
    if (queryLower.includes("cron") || queryLower.includes("schedule"))
      relevantTopics.push("automation");
    if (queryLower.includes("clawdhub") || queryLower.includes("registry"))
      relevantTopics.push("clawdhub");
    if (
      queryLower.includes("openclaw") ||
      queryLower.includes("frontmatter") ||
      queryLower.includes("metadata")
    )
      relevantTopics.push("skills");

    const uniqueTopics = [...new Set(relevantTopics)].slice(0, 3);

    if (uniqueTopics.length === 0) {
      return `No matching documentation found for: "${query}"\n\nAvailable topics: ${Object.keys(DOC_PAGES).join(", ")}`;
    }

    // Always fetch OpenClaw index for context
    const openclawIndex = await this.fetchOpenClawIndex();

    const results: string[] = [`# Documentation for: ${query}\n`];

    // Include OpenClaw index summary if skills-related
    if (uniqueTopics.some((t) => OPENCLAW_TOPICS.has(t))) {
      results.push(
        `## OpenClaw Documentation Index\n\n${openclawIndex.slice(0, 1500)}\n`,
      );
    }

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

// OpenClaw/AgentSkills-compatible SKILL.md template
// Format: YAML frontmatter + markdown content
// See: https://docs.openclaw.ai/tools/skills
const SKILL_TEMPLATE = `---
name: {{NAME}}
description: {{DESCRIPTION}}
{{FRONTMATTER}}---

{{CONTENT}}
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

// Browser automation skill template - uses OpenClaw browser tool
const BROWSER_SKILL_TEMPLATE = `---
name: {{NAME}}
description: {{DESCRIPTION}}
{{FRONTMATTER}}---

# {{DISPLAY_NAME}}

{{DESCRIPTION}}

## Browser Actions

This skill uses the OpenClaw \`browser\` tool for web automation.

### Available Actions

The browser tool supports:
- **Navigation**: \`browser open <url>\`, tab management
- **Inspection**: \`browser snapshot\` (AI or ARIA format)
- **Actions**: click, type, select using snapshot refs
- **State**: cookies, headers, credentials, geolocation

### Usage Pattern

\`\`\`
1. Open the target URL: browser open <url>
2. Take a snapshot: browser snapshot
3. Interact using refs from snapshot: browser click ref=<id>
4. Verify state with another snapshot
\`\`\`

{{CONTENT}}

## Authentication

{{AUTH_SECTION}}

## Notes

- Use \`{baseDir}\` to reference files in this skill folder
- The browser runs in the \`openclaw\` profile (isolated from personal browsing)
- For sites with anti-bot detection, authenticate manually first
`;

// Hook template - HOOK.md + handler.ts pattern
const HOOK_MD_TEMPLATE = `---
name: {{NAME}}
description: {{DESCRIPTION}}
metadata: {{METADATA}}
---

# {{DISPLAY_NAME}}

{{DESCRIPTION}}

## Events

This hook triggers on: {{EVENTS}}

## Behavior

{{CONTENT}}
`;

const HOOK_HANDLER_TEMPLATE = `/**
 * {{NAME}} Hook Handler
 * Auto-generated by Foundry
 *
 * Events: {{EVENTS}}
 */

import type { HookHandler, HookEvent } from "openclaw/hooks";

{{CODE}}

export default handler;
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
  // RISE (arXiv:2407.18219): Multi-turn recursive introspection
  attemptCount?: number;
  improvementTrajectory?: number[];
  // SelfEvolve (arXiv:2306.02907): Interpreter feedback
  executionFeedback?: string[];
  // HexMachina (arXiv:2506.04651): Crystallization tracking
  crystallizedTo?: string;
  crystallizedAt?: string;
}

// Self-Improving Coding Agent (arXiv:2504.15228): Overseer report
interface OverseerReport {
  timestamp: string;
  patternsAnalyzed: number;
  crystallizationCandidates: LearningEntry[];
  recurringFailures: {
    signature: string;
    count: number;
    entries: LearningEntry[];
  }[];
  evolutionCandidates: ToolMetrics[]; // ADAS: Tools needing evolution
  actionsExecuted: string[];
}

// ADAS (arXiv:2408.08435): Tool performance metrics
interface ToolMetrics {
  toolName: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  fitness: number;
}

// Outcome-based learning: track real-world feedback signals
interface TaskOutcome {
  id: string;
  taskType: string; // "tiktok_post", "tweet", "linkedin_post", "email_campaign", etc.
  taskDescription: string; // what was done
  taskParams: Record<string, any>; // content, timing, hashtags, audience, etc.
  executedAt: string;
  feedbackCollectedAt?: string;
  feedbackSource?: string; // "tiktok_analytics", "twitter_api", "manual", etc.
  metrics: Record<string, number>; // views, likes, shares, comments, ctr, etc.
  success?: boolean; // determined by threshold comparison
  successThreshold?: Record<string, number>; // what counts as success
  insights: string[]; // extracted learnings
}

interface TaskTypeInsights {
  taskType: string;
  totalTasks: number;
  successfulTasks: number;
  avgMetrics: Record<string, number>;
  topPerformers: TaskOutcome[]; // top 3 by primary metric
  patterns: {
    successful: string[]; // what successful tasks have in common
    unsuccessful: string[]; // what failed tasks have in common
  };
  recommendations: string[]; // actionable insights
  lastUpdated: string;
  // Auto-improvement: when patterns are strong enough, suggest skill modifications
  improvementSuggestion?: {
    confidence: number; // 0-1, based on sample size and pattern strength
    targetSkill?: string; // skill to modify
    suggestedChanges: string[]; // what to change
    appliedAt?: string; // when improvement was applied
  };
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

// ── Workflow Learning Types ─────────────────────────────────────────────────

interface WorkflowEntry {
  id: string;
  goal: string; // User's intent extracted from first message
  toolSequence: string[]; // Ordered list of tools called
  startedAt: number;
  completedAt: number;
  outcome: "success" | "failure" | "partial";
  context: string; // Summary of what was achieved
}

interface WorkflowPattern {
  id: string;
  signature: string; // Normalized: "tool1→tool2→tool3"
  goalKeywords: string[]; // Common goal words across occurrences
  occurrences: number; // How many times this pattern appeared
  successRate: number; // % of successful outcomes
  avgDuration: number; // Average time to complete (ms)
  crystallizedTo?: string; // Tool ID if converted to a tool
  lastOccurrence: number;
}

interface WorkflowSuggestion {
  patternId: string;
  signature: string;
  description: string; // "You often do X when [goal keywords]"
  confidence: number; // 0-1 based on occurrences and success rate
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

// OpenClaw/AgentSkills-compatible skill metadata
interface SkillMetadata {
  openclaw?: {
    always?: boolean;
    emoji?: string;
    homepage?: string;
    os?: ("darwin" | "linux" | "win32")[];
    primaryEnv?: string;
    skillKey?: string;
    requires?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
    };
    install?: {
      id: string;
      kind: "brew" | "node" | "go" | "uv" | "download";
      formula?: string;
      package?: string;
      bins?: string[];
      label?: string;
      url?: string;
      os?: ("darwin" | "linux" | "win32")[];
    }[];
  };
}

interface SkillDef {
  name: string;
  description: string;
  // OpenClaw frontmatter options
  homepage?: string;
  userInvocable?: boolean; // default: true
  disableModelInvocation?: boolean; // default: false
  commandDispatch?: "tool";
  commandTool?: string;
  commandArgMode?: "raw";
  metadata?: SkillMetadata;
  // Legacy API-based skill support (optional)
  baseUrl?: string;
  endpoints?: EndpointDef[];
  authHeaders?: Record<string, string>;
  // Skill content (markdown body after frontmatter)
  content?: string;
  createdAt: string;
}

interface EndpointDef {
  method: string;
  path: string;
  description: string;
  params?: Record<string, string>;
}

// Browser skill definition - for browser automation skills
interface BrowserSkillDef {
  name: string;
  description: string;
  // Target site/service
  targetUrl?: string;
  // Browser actions to document
  actions?: {
    name: string;
    description: string;
    steps?: string[];
  }[];
  // Authentication approach
  authMethod?: "manual" | "cookie" | "header" | "oauth";
  authNotes?: string;
  // OpenClaw metadata
  metadata?: SkillMetadata;
  // Custom content
  content?: string;
  createdAt?: string;
}

// Hook definition - for event-driven automation
interface OpenClawHookDef {
  name: string;
  description: string;
  // Events to trigger on
  events: (
    | "command:new"
    | "command:reset"
    | "command:stop"
    | "agent:bootstrap"
    | "gateway:startup"
    | "tool_result_persist"
  )[];
  // Hook code (handler function body)
  code: string;
  // OpenClaw metadata
  metadata?: {
    openclaw?: {
      emoji?: string;
      requires?: {
        bins?: string[];
        env?: string[];
        config?: string[];
      };
      always?: boolean;
    };
  };
  createdAt?: string;
}

// ── Extension Writer ─────────────────────────────────────────────────────────

class CodeWriter {
  private extensionsDir: string;
  private skillsDir: string;
  private manifestPath: string;
  private manifest: { extensions: ExtensionDef[]; skills: SkillDef[] } = {
    extensions: [],
    skills: [],
  };
  private openclawDocs: { plugin: string; hooks: string } = {
    plugin: "",
    hooks: "",
  };

  constructor(
    private dataDir: string,
    private openclawPath: string,
    private logger?: { info: (msg: string) => void },
  ) {
    this.extensionsDir = join(homedir(), ".openclaw", "extensions");
    this.skillsDir = join(homedir(), ".openclaw", "skills");
    this.manifestPath = join(dataDir, "manifest.json");

    if (!existsSync(this.extensionsDir))
      mkdirSync(this.extensionsDir, { recursive: true });
    if (!existsSync(this.skillsDir))
      mkdirSync(this.skillsDir, { recursive: true });

    this.loadManifest();
    this.loadOpenClawDocs();
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

  private loadOpenClawDocs(): void {
    const pluginDocPath = join(this.openclawPath, "docs", "plugin.md");
    const hooksDocPath = join(this.openclawPath, "docs", "hooks.md");

    if (existsSync(pluginDocPath)) {
      this.openclawDocs.plugin = readFileSync(pluginDocPath, "utf-8");
      this.logger?.info("[foundry] Loaded plugin docs");
    }
    if (existsSync(hooksDocPath)) {
      this.openclawDocs.hooks = readFileSync(hooksDocPath, "utf-8");
      this.logger?.info("[foundry] Loaded hooks docs");
    }
  }

  getDocs(): { plugin: string; hooks: string } {
    return this.openclawDocs;
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

    const toolsCode = def.tools
      .map((t) => {
        const props = Object.entries(t.properties)
          .map(
            ([k, v]) =>
              `          ${k}: { type: "${v.type}", description: "${v.description.replace(/"/g, '\\"')}" },`,
          )
          .join("\n");
        const req = t.required.map((r) => `"${r}"`).join(", ");

        return TOOL_TEMPLATE.replace(/\{\{NAME\}\}/g, t.name)
          .replace(/\{\{LABEL\}\}/g, t.label || t.name)
          .replace(/\{\{DESCRIPTION\}\}/g, t.description.replace(/"/g, '\\"'))
          .replace(/\{\{PROPERTIES\}\}/g, props)
          .replace(/\{\{REQUIRED\}\}/g, req)
          .replace(
            /\{\{CODE\}\}/g,
            t.code
              .split("\n")
              .map((l) => "        " + l)
              .join("\n"),
          );
      })
      .join("\n");

    const hooksCode = def.hooks
      .map((h) => {
        return HOOK_TEMPLATE.replace(/\{\{EVENT\}\}/g, h.event).replace(
          /\{\{CODE\}\}/g,
          h.code
            .split("\n")
            .map((l) => "      " + l)
            .join("\n"),
        );
      })
      .join("\n");

    const extensionCode = EXTENSION_TEMPLATE.replace(/\{\{ID\}\}/g, def.id)
      .replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{DATE\}\}/g, full.createdAt)
      .replace(/\{\{TOOLS\}\}/g, toolsCode)
      .replace(/\{\{HOOKS\}\}/g, hooksCode);

    // Validate before writing
    let validation: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      securityFlags: [],
    };
    if (validator) {
      validation = await validator.validate(extensionCode, "extension");

      // Block if validation failed
      if (!validation.valid) {
        this.logger?.info(
          `[foundry] Extension ${def.id} BLOCKED: ${validation.errors.join(", ")}`,
        );
        throw new Error(
          `Code validation failed: ${validation.errors.join(", ")}`,
        );
      }

      // Log warnings
      if (validation.warnings.length > 0) {
        this.logger?.info(
          `[foundry] Extension ${def.id} warnings: ${validation.warnings.join(", ")}`,
        );
      }

      // Run in sandbox to catch runtime errors BEFORE writing
      const sandboxDir = join(this.dataDir, "sandbox");
      const sandboxResult = await validator.testInSandbox(
        extensionCode,
        sandboxDir,
      );
      if (!sandboxResult.success) {
        this.logger?.info(
          `[foundry] Extension ${def.id} SANDBOX FAILED: ${sandboxResult.error}`,
        );
        throw new Error(`Sandbox test failed: ${sandboxResult.error}`);
      }
      this.logger?.info(`[foundry] Extension ${def.id} passed sandbox test`);
    }

    const extDir = join(this.extensionsDir, def.id);
    if (!existsSync(extDir)) mkdirSync(extDir, { recursive: true });

    writeFileSync(join(extDir, "index.ts"), extensionCode);
    writeFileSync(
      join(extDir, "openclaw.plugin.json"),
      PLUGIN_JSON_TEMPLATE.replace(/\{\{ID\}\}/g, def.id)
        .replace(/\{\{NAME\}\}/g, def.name)
        .replace(/\{\{DESCRIPTION\}\}/g, def.description),
    );

    const idx = this.manifest.extensions.findIndex((e) => e.id === def.id);
    if (idx >= 0) this.manifest.extensions[idx] = full;
    else this.manifest.extensions.push(full);
    this.saveManifest();

    this.logger?.info(
      `[foundry] Wrote extension: ${def.id} (${validation.warnings.length} warnings, ${validation.securityFlags.length} flags)`,
    );
    return { path: extDir, validation };
  }

  addTool(extensionId: string, tool: ToolDef): boolean {
    const ext = this.manifest.extensions.find((e) => e.id === extensionId);
    if (!ext) return false;
    ext.tools.push(tool);
    this.writeExtension(ext);
    return true;
  }

  addHook(extensionId: string, hook: HookDef): boolean {
    const ext = this.manifest.extensions.find((e) => e.id === extensionId);
    if (!ext) return false;
    ext.hooks.push(hook);
    this.writeExtension(ext);
    return true;
  }

  // ── Skill Writing (OpenClaw/AgentSkills-compatible) ─────────────────────────

  writeSkill(def: Omit<SkillDef, "createdAt">): string {
    const full: SkillDef = { ...def, createdAt: new Date().toISOString() };
    const skillDir = join(
      this.skillsDir,
      def.name.toLowerCase().replace(/\s+/g, "-"),
    );

    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    // Build YAML frontmatter (AgentSkills-compatible, single-line JSON for metadata)
    const frontmatterLines: string[] = [];

    // Optional frontmatter fields
    if (def.homepage) {
      frontmatterLines.push(`homepage: ${def.homepage}`);
    }
    if (def.userInvocable === false) {
      frontmatterLines.push(`user-invocable: false`);
    }
    if (def.disableModelInvocation === true) {
      frontmatterLines.push(`disable-model-invocation: true`);
    }
    if (def.commandDispatch) {
      frontmatterLines.push(`command-dispatch: ${def.commandDispatch}`);
    }
    if (def.commandTool) {
      frontmatterLines.push(`command-tool: ${def.commandTool}`);
    }
    if (def.commandArgMode) {
      frontmatterLines.push(`command-arg-mode: ${def.commandArgMode}`);
    }

    // Metadata must be single-line JSON per OpenClaw spec
    if (def.metadata) {
      frontmatterLines.push(`metadata: ${JSON.stringify(def.metadata)}`);
    }

    const frontmatter =
      frontmatterLines.length > 0 ? frontmatterLines.join("\n") + "\n" : "";

    // Build skill content
    let content = def.content || "";

    // If legacy API-based skill, generate content from endpoints
    if (def.baseUrl && def.endpoints && def.endpoints.length > 0) {
      const endpointsDoc = def.endpoints
        .map((e) => `- \`${e.method} ${e.path}\` — ${e.description}`)
        .join("\n");

      content = `## Endpoints

${endpointsDoc}

## Usage

\`\`\`typescript
import { ${toPascalCase(def.name)}Client } from "./api";

const client = new ${toPascalCase(def.name)}Client();
// Use the client methods...
\`\`\`

## Auth

${def.authHeaders ? "Auth headers stored in auth.json" : "No auth required"}`;

      // Generate api.ts for API-based skills
      const methods = def.endpoints
        .map((e) => {
          const methodName = toMethodName(e.method, e.path);
          const pathParams = (e.path.match(/\{(\w+)\}/g) || []).map((p) =>
            p.slice(1, -1),
          );

          let methodCode = `  async ${methodName}(`;
          if (pathParams.length > 0) {
            methodCode += pathParams.map((p) => `${p}: string`).join(", ");
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
        })
        .join("\n");

      const apiTs = API_CLIENT_TEMPLATE.replace(/\{\{NAME\}\}/g, def.name)
        .replace(/\{\{BASE_URL\}\}/g, def.baseUrl)
        .replace(/\{\{CLIENT_NAME\}\}/g, toPascalCase(def.name) + "Client")
        .replace(/\{\{METHODS\}\}/g, methods);

      writeFileSync(join(skillDir, "api.ts"), apiTs);

      // Save auth if provided
      if (def.authHeaders) {
        writeFileSync(
          join(skillDir, "auth.json"),
          JSON.stringify({ headers: def.authHeaders }, null, 2),
        );
      }
    }

    // Generate SKILL.md with proper OpenClaw/AgentSkills format
    const skillMd = SKILL_TEMPLATE.replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{FRONTMATTER\}\}/g, frontmatter)
      .replace(/\{\{CONTENT\}\}/g, content);

    writeFileSync(join(skillDir, "SKILL.md"), skillMd);

    const idx = this.manifest.skills.findIndex((s) => s.name === def.name);
    if (idx >= 0) this.manifest.skills[idx] = full;
    else this.manifest.skills.push(full);
    this.saveManifest();

    this.logger?.info(`[foundry] Wrote skill: ${def.name}`);
    return skillDir;
  }

  // ── Browser Skill Writing ─────────────────────────────────────────────────

  writeBrowserSkill(def: BrowserSkillDef): string {
    const skillDir = join(
      this.skillsDir,
      def.name.toLowerCase().replace(/\s+/g, "-"),
    );
    if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

    // Build frontmatter
    const frontmatterLines: string[] = [];

    // Browser skills require browser.enabled config
    const metadata = def.metadata || {};
    if (!metadata.openclaw) metadata.openclaw = {};
    if (!metadata.openclaw.requires) metadata.openclaw.requires = {};
    if (!metadata.openclaw.requires.config)
      metadata.openclaw.requires.config = [];
    if (!metadata.openclaw.requires.config.includes("browser.enabled")) {
      metadata.openclaw.requires.config.push("browser.enabled");
    }

    frontmatterLines.push(`metadata: ${JSON.stringify(metadata)}`);

    const frontmatter = frontmatterLines.join("\n") + "\n";

    // Build actions content
    let actionsContent = "";
    if (def.actions && def.actions.length > 0) {
      actionsContent = "### Documented Actions\n\n";
      for (const action of def.actions) {
        actionsContent += `#### ${action.name}\n\n${action.description}\n\n`;
        if (action.steps && action.steps.length > 0) {
          actionsContent += "Steps:\n";
          action.steps.forEach((step, i) => {
            actionsContent += `${i + 1}. ${step}\n`;
          });
          actionsContent += "\n";
        }
      }
    }

    // Build auth section
    let authSection = "No special authentication required.";
    if (def.authMethod === "manual") {
      authSection = `**Manual Login Required**\n\nSign in to ${def.targetUrl || "the target site"} in the openclaw browser profile before using this skill.\n\n${def.authNotes || ""}`;
    } else if (def.authMethod === "cookie") {
      authSection = `**Cookie-based Authentication**\n\nCookies are preserved in the browser profile.\n\n${def.authNotes || ""}`;
    } else if (def.authMethod === "header") {
      authSection = `**Header-based Authentication**\n\nSet auth headers via browser tool state management.\n\n${def.authNotes || ""}`;
    } else if (def.authMethod === "oauth") {
      authSection = `**OAuth Authentication**\n\nUse auth-profiles for OAuth token management.\n\n${def.authNotes || ""}`;
    }

    // Combine custom content
    const fullContent = `${actionsContent}${def.content || ""}`.trim();

    // Generate SKILL.md
    const skillMd = BROWSER_SKILL_TEMPLATE.replace(/\{\{NAME\}\}/g, def.name)
      .replace(
        /\{\{DISPLAY_NAME\}\}/g,
        toPascalCase(def.name.replace(/-/g, " ")),
      )
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{FRONTMATTER\}\}/g, frontmatter)
      .replace(/\{\{CONTENT\}\}/g, fullContent)
      .replace(/\{\{AUTH_SECTION\}\}/g, authSection);

    writeFileSync(join(skillDir, "SKILL.md"), skillMd);

    this.logger?.info(`[foundry] Wrote browser skill: ${def.name}`);
    return skillDir;
  }

  // ── Hook Writing ──────────────────────────────────────────────────────────

  writeHook(def: OpenClawHookDef): string {
    const hooksDir = join(homedir(), ".openclaw", "hooks");
    const hookDir = join(hooksDir, def.name.toLowerCase().replace(/\s+/g, "-"));
    if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });

    // Build metadata - events go at openclaw level per hook spec
    const metadata: Record<string, any> = def.metadata || {};
    if (!metadata.openclaw) metadata.openclaw = {};
    (metadata.openclaw as any).events = def.events;

    const metadataJson = JSON.stringify(metadata);
    const eventsStr = def.events.join(", ");

    // Generate HOOK.md
    const hookMd = HOOK_MD_TEMPLATE.replace(/\{\{NAME\}\}/g, def.name)
      .replace(
        /\{\{DISPLAY_NAME\}\}/g,
        toPascalCase(def.name.replace(/-/g, " ")),
      )
      .replace(/\{\{DESCRIPTION\}\}/g, def.description)
      .replace(/\{\{METADATA\}\}/g, metadataJson)
      .replace(/\{\{EVENTS\}\}/g, eventsStr)
      .replace(
        /\{\{CONTENT\}\}/g,
        def.code
          ? "Custom handler logic implemented below."
          : "No custom behavior defined.",
      );

    writeFileSync(join(hookDir, "HOOK.md"), hookMd);

    // Generate handler.ts
    const handlerCode =
      def.code ||
      `const handler: HookHandler = async (event: HookEvent) => {
  // Event type: ${eventsStr}
  console.log("[${def.name}] Hook triggered:", event.type, event.action);
};`;

    const handlerTs = HOOK_HANDLER_TEMPLATE.replace(/\{\{NAME\}\}/g, def.name)
      .replace(/\{\{EVENTS\}\}/g, eventsStr)
      .replace(/\{\{CODE\}\}/g, handlerCode);

    writeFileSync(join(hookDir, "handler.ts"), handlerTs);

    this.logger?.info(`[foundry] Wrote hook: ${def.name}`);
    return hookDir;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getExtensions(): ExtensionDef[] {
    return this.manifest.extensions;
  }

  getSkills(): SkillDef[] {
    return this.manifest.skills;
  }

  getExtension(id: string): ExtensionDef | undefined {
    return this.manifest.extensions.find((e) => e.id === id);
  }
}

// ── Learning Engine ─────────────────────────────────────────────────────────

class LearningEngine {
  private learningsPath: string;
  private pendingSessionPath: string;
  private metricsPath: string;
  private outcomesPath: string;
  private insightsPath: string;
  private workflowsPath: string;
  private workflowPatternsPath: string;
  private learnings: LearningEntry[] = [];
  private pendingSession: PendingSession | null = null;
  private toolMetrics: Map<string, ToolMetrics> = new Map();
  private overseerInterval: NodeJS.Timeout | null = null;
  private lastOverseerReport: OverseerReport | null = null;
  // Outcome-based learning
  private outcomes: TaskOutcome[] = [];
  private taskTypeInsights: Map<string, TaskTypeInsights> = new Map();
  private feedbackCollectionInterval: NodeJS.Timeout | null = null;
  // Workflow learning
  private workflows: WorkflowEntry[] = [];
  private workflowPatterns: Map<string, WorkflowPattern> = new Map();
  private currentWorkflow: {
    goal: string;
    tools: string[];
    startedAt: number;
  } | null = null;

  constructor(
    private dataDir: string,
    private logger?: {
      info: (msg: string) => void;
      warn?: (msg: string) => void;
    },
  ) {
    this.learningsPath = join(dataDir, "learnings.json");
    this.pendingSessionPath = join(dataDir, "pending-session.json");
    this.metricsPath = join(dataDir, "metrics.json");
    this.outcomesPath = join(dataDir, "outcomes.json");
    this.insightsPath = join(dataDir, "task-insights.json");
    this.workflowsPath = join(dataDir, "workflows.json");
    this.workflowPatternsPath = join(dataDir, "workflow-patterns.json");

    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.loadLearnings();
    this.loadPendingSession();
    this.loadOutcomes();
    this.loadMetrics();
    this.loadWorkflows();
  }

  private loadMetrics(): void {
    if (existsSync(this.metricsPath)) {
      try {
        const data = JSON.parse(readFileSync(this.metricsPath, "utf-8"));
        this.toolMetrics = new Map(Object.entries(data));
      } catch {
        this.toolMetrics = new Map();
      }
    }
  }

  private saveMetrics(): void {
    const obj = Object.fromEntries(this.toolMetrics);
    writeFileSync(this.metricsPath, JSON.stringify(obj, null, 2));
  }

  // ADAS: Record tool execution for fitness tracking
  recordToolExecution(
    toolName: string,
    success: boolean,
    latencyMs: number,
  ): void {
    let metrics = this.toolMetrics.get(toolName);
    if (!metrics) {
      metrics = {
        toolName,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        fitness: 0.5,
      };
    }
    if (success) metrics.successCount++;
    else metrics.failureCount++;
    metrics.totalLatencyMs += latencyMs;
    metrics.fitness =
      metrics.successCount / (metrics.successCount + metrics.failureCount);
    this.toolMetrics.set(toolName, metrics);
    this.saveMetrics();
  }

  getToolFitness(toolName: string): number {
    return this.toolMetrics.get(toolName)?.fitness ?? 0.5;
  }

  getAllToolMetrics(): ToolMetrics[] {
    return Array.from(this.toolMetrics.values());
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
        this.pendingSession = JSON.parse(
          readFileSync(this.pendingSessionPath, "utf-8"),
        );
        this.logger?.info(
          `[foundry] Found pending session from: ${this.pendingSession?.reason}`,
        );
      } catch {
        this.pendingSession = null;
      }
    }
  }

  // ── Learning from failures ───────────────────────────────────────────────
  // RISE (arXiv:2407.18219): Recursive introspection with attempt tracking

  private extractErrorSignature(error: string): string {
    return error
      .replace(/\d+/g, "N")
      .replace(/0x[a-f0-9]+/gi, "ADDR")
      .replace(/["'][^"']*["']/g, "STR")
      .replace(/at .*:\d+:\d+/g, "at LOCATION")
      .slice(0, 150);
  }

  findSimilarPattern(tool: string, error: string): LearningEntry | undefined {
    const signature = this.extractErrorSignature(error);
    return this.learnings.find(
      (l) =>
        l.type === "pattern" &&
        l.tool === tool &&
        l.error &&
        this.extractErrorSignature(l.error) === signature,
    );
  }

  private findSimilarFailure(
    tool: string,
    error: string,
  ): LearningEntry | undefined {
    const signature = this.extractErrorSignature(error);
    return this.learnings.find(
      (l) =>
        l.type === "failure" &&
        l.tool === tool &&
        l.error &&
        this.extractErrorSignature(l.error) === signature,
    );
  }

  recordFailure(
    tool: string,
    error: string,
    context?: string,
    executionFeedback?: string,
  ): string {
    // RISE: Check for similar past failures to track attempt progression
    const similar = this.findSimilarFailure(tool, error);
    const attemptCount = similar ? (similar.attemptCount || 0) + 1 : 1;
    const trajectory = similar
      ? [...(similar.improvementTrajectory || []), 0]
      : [0];

    const id = `fail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry: LearningEntry = {
      id,
      type: "failure",
      tool,
      error,
      context,
      timestamp: new Date().toISOString(),
      useCount: 0,
      attemptCount,
      improvementTrajectory: trajectory,
      executionFeedback: executionFeedback ? [executionFeedback] : [],
    };
    this.learnings.push(entry);
    this.saveLearnings();

    if (attemptCount > 1) {
      this.logger?.info(
        `[foundry] RISE: Attempt #${attemptCount} for ${tool} - ${error.slice(0, 40)}...`,
      );
    } else {
      this.logger?.info(
        `[foundry] Recorded failure: ${tool} - ${error.slice(0, 50)}...`,
      );
    }
    return id;
  }

  // SelfEvolve: Add interpreter feedback to existing failure
  addExecutionFeedback(failureId: string, feedback: string): void {
    const entry = this.learnings.find((l) => l.id === failureId);
    if (entry) {
      entry.executionFeedback = entry.executionFeedback || [];
      entry.executionFeedback.push(feedback);
      this.saveLearnings();
    }
  }

  recordResolution(failureId: string, resolution: string): void {
    const entry = this.learnings.find((l) => l.id === failureId);
    if (entry) {
      entry.resolution = resolution;
      entry.type = "pattern";
      // RISE: Mark success in trajectory
      if (
        entry.improvementTrajectory &&
        entry.improvementTrajectory.length > 0
      ) {
        const lastIdx = entry.improvementTrajectory.length - 1;
        entry.improvementTrajectory[lastIdx] = 1.0;
      }
      this.saveLearnings();
      this.logger?.info(
        `[foundry] Pattern created (attempt #${entry.attemptCount || 1}): ${entry.tool}`,
      );
    }
  }

  // HexMachina: Check if pattern should be crystallized
  // Lowered threshold: any pattern with a resolution can be manually crystallized
  shouldCrystallize(pattern: LearningEntry): boolean {
    return (
      pattern.type === "pattern" &&
      !pattern.crystallizedTo &&
      !!pattern.resolution
    );
  }

  getCrystallizationCandidates(): LearningEntry[] {
    return this.learnings.filter((l) => this.shouldCrystallize(l));
  }

  markCrystallized(patternId: string, artifactId: string): void {
    const entry = this.learnings.find((l) => l.id === patternId);
    if (entry) {
      entry.crystallizedTo = artifactId;
      entry.crystallizedAt = new Date().toISOString();
      this.saveLearnings();
      this.logger?.info(
        `[foundry] HexMachina: Crystallized ${patternId} → ${artifactId}`,
      );
    }
  }

  // RISE: Calculate pattern effectiveness score
  calculatePatternScore(entry: LearningEntry): number {
    let score = entry.useCount || 0;
    const trajectory = entry.improvementTrajectory || [];
    if (trajectory.length > 0) {
      const avgSuccess =
        trajectory.reduce((a, b) => a + b, 0) / trajectory.length;
      score += avgSuccess * 5;
    }
    if (entry.crystallizedTo) score += 10;
    return score;
  }

  recordPatternUse(patternId: string): void {
    const entry = this.learnings.find((l) => l.id === patternId);
    if (entry) {
      entry.useCount = (entry.useCount || 0) + 1;
      this.saveLearnings();
    }
  }

  // RISE: Record that a pattern-assisted retry succeeded
  recordPatternSuccess(patternId: string): void {
    const entry = this.learnings.find((l) => l.id === patternId);
    if (entry) {
      // Update improvement trajectory to show success
      if (!entry.improvementTrajectory) entry.improvementTrajectory = [];
      entry.improvementTrajectory.push(1.0);
      this.saveLearnings();
      this.logger?.info(
        `[foundry] RISE: Pattern ${patternId} success recorded (trajectory: ${entry.improvementTrajectory.length})`,
      );
    }
  }

  // RISE: Check if pattern should auto-crystallize based on successful uses
  shouldAutoCrystallize(pattern: LearningEntry): boolean {
    if (pattern.crystallizedTo) return false; // Already crystallized
    if (!pattern.resolution) return false; // No resolution to crystallize

    // Auto-crystallize after 3 successful RISE-assisted retries
    const trajectory = pattern.improvementTrajectory || [];
    const successCount = trajectory.filter((v) => v === 1.0).length;
    return successCount >= 3;
  }

  // Get a specific pattern by ID
  getPattern(patternId: string): LearningEntry | undefined {
    return this.learnings.find((l) => l.id === patternId);
  }

  // Get all learnings
  getAll(): LearningEntry[] {
    return this.learnings;
  }

  // Self-Improving Coding Agent: Overseer mechanism
  // Takes AUTONOMOUS ACTION - not just reporting
  runOverseer(dataDir?: string): OverseerReport {
    const report: OverseerReport = {
      timestamp: new Date().toISOString(),
      patternsAnalyzed: this.learnings.filter((l) => l.type === "pattern")
        .length,
      crystallizationCandidates: this.getCrystallizationCandidates(),
      recurringFailures: [],
      evolutionCandidates: [],
      actionsExecuted: [],
    };

    // ADAS: Identify underperforming tools for evolution
    const EVOLUTION_THRESHOLD = 0.4; // Tools below 40% fitness
    const MIN_SAMPLES = 5; // Need at least 5 executions
    for (const [toolName, metrics] of this.toolMetrics) {
      const totalCalls = metrics.successCount + metrics.failureCount;
      if (totalCalls >= MIN_SAMPLES && metrics.fitness < EVOLUTION_THRESHOLD) {
        report.evolutionCandidates.push(metrics);
      }
    }

    // Find recurring failures (same error signature 3+ times without resolution)
    const failureCounts = new Map<string, LearningEntry[]>();
    for (const l of this.learnings.filter(
      (l) => l.type === "failure" && !l.resolution,
    )) {
      const sig = `${l.tool}:${this.extractErrorSignature(l.error || "")}`;
      const existing = failureCounts.get(sig) || [];
      existing.push(l);
      failureCounts.set(sig, existing);
    }

    for (const [sig, entries] of failureCounts) {
      if (entries.length >= 3) {
        report.recurringFailures.push({
          signature: sig,
          count: entries.length,
          entries,
        });
      }
    }

    // AUTONOMOUS ACTION 1: Auto-crystallize high-value patterns
    // Only when we have a dataDir to write hooks to
    if (dataDir) {
      const hooksDir = join(dataDir, "hooks");
      if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

      for (const candidate of report.crystallizationCandidates) {
        // Auto-crystallize patterns that have been used 5+ times (very high value)
        if (candidate.useCount >= 5 && candidate.resolution) {
          const hookId = `auto_crystallized_${candidate.tool}_${Date.now()}`;
          const escapedError = (candidate.error || "")
            .replace(/`/g, "'")
            .slice(0, 100);
          const escapedResolution = (candidate.resolution || "")
            .replace(/`/g, "'")
            .slice(0, 200);

          const hookCode = `
    // Auto-crystallized by Overseer from pattern: ${candidate.id}
    api.on("before_tool_call", async (event, ctx) => {
      if (event.toolName === "${candidate.tool}") {
        // Original error: ${escapedError}
        // Learned resolution: ${escapedResolution}
        if (ctx?.injectSystemMessage) {
          ctx.injectSystemMessage(\`
[AUTO-CRYSTALLIZED PATTERN]
Before calling ${candidate.tool}, apply this learned approach:
${escapedResolution}
\`);
        }
      }
    });`;

          const hookPath = join(hooksDir, `${hookId}.ts`);
          writeFileSync(hookPath, hookCode);
          this.markCrystallized(candidate.id, hookId);
          report.actionsExecuted.push(
            `Auto-crystallized pattern ${candidate.id} → ${hookId}`,
          );
        }
      }
    }

    // AUTONOMOUS ACTION 2: Prune stale patterns (no uses in 30 days, never crystallized)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stalePruned = this.learnings.filter((l) => {
      if (l.type !== "pattern" || l.crystallizedTo) return false;
      const ts = new Date(l.timestamp).getTime();
      return ts < thirtyDaysAgo && (l.useCount || 0) === 0;
    });

    if (stalePruned.length > 0) {
      this.learnings = this.learnings.filter((l) => !stalePruned.includes(l));
      this.saveLearnings();
      report.actionsExecuted.push(
        `Pruned ${stalePruned.length} stale patterns`,
      );
    }

    // AUTONOMOUS ACTION 3: Consolidate duplicate failures into patterns
    for (const { signature, count, entries } of report.recurringFailures) {
      if (count >= 5) {
        // This failure is recurring enough to warrant attention
        // Create an insight about it
        const latest = entries[entries.length - 1];
        this.recordInsight(
          `Recurring failure (${count}x): ${signature.slice(0, 80)}`,
          `Tool: ${latest.tool}, Error: ${latest.error?.slice(0, 100)}`,
        );
        report.actionsExecuted.push(
          `Created insight for recurring failure: ${signature.slice(0, 50)}...`,
        );
      }
    }

    // AUTONOMOUS ACTION 4: Auto-promote known error patterns
    const autoPromoted = this.autoPromoteKnownPatterns();
    if (autoPromoted > 0) {
      report.actionsExecuted.push(`Auto-promoted ${autoPromoted} known error patterns`);
    }

    this.logger?.info(
      `[foundry] Overseer: ${report.patternsAnalyzed} patterns, ${report.crystallizationCandidates.length} candidates, ${report.recurringFailures.length} recurring failures, ${report.evolutionCandidates.length} evolution candidates, ${report.actionsExecuted.length} actions taken`,
    );

    // Save report for proactive evolution injection
    this.lastOverseerReport = report;
    return report;
  }

  getLastOverseerReport(): OverseerReport | null {
    return this.lastOverseerReport;
  }

  // Start autonomous overseer
  startOverseer(intervalMs = 60 * 60 * 1000, dataDir?: string): void {
    if (this.overseerInterval) return;
    this.overseerInterval = setInterval(() => {
      this.runOverseer(dataDir);
    }, intervalMs);
    this.logger?.info(
      `[foundry] Autonomous overseer started (interval: ${intervalMs}ms)`,
    );
  }

  stopOverseer(): void {
    if (this.overseerInterval) {
      clearInterval(this.overseerInterval);
      this.overseerInterval = null;
    }
  }

  // Auto-promote known error patterns with standard resolutions
  autoPromoteKnownPatterns(): number {
    const KNOWN_PATTERNS: { match: RegExp; resolution: string }[] = [
      {
        match: /Cannot use import statement outside a module/i,
        resolution: "Use inline code only. Do not use import/require statements. All dependencies must be inlined or use global APIs available in the plugin context.",
      },
      {
        match: /BLOCKED: Child process import/i,
        resolution: "Do not import child_process, exec, spawn, or execSync. Use HTTP APIs or built-in Node APIs instead of shell commands.",
      },
      {
        match: /BLOCKED: Shell execution/i,
        resolution: "Do not use exec(), spawn(), or shell commands. Use direct API calls or the plugin SDK methods instead.",
      },
      {
        match: /BLOCKED: Dynamic code execution/i,
        resolution: "Do not use eval() or new Function(). Use static code patterns only.",
      },
      {
        match: /Sandbox.*failed|runtime.*error/i,
        resolution: "Ensure all variables are defined before use, handle null/undefined cases, and use try/catch for async operations.",
      },
    ];

    let promoted = 0;
    const unresolved = this.learnings.filter(l => l.type === "failure" && !l.resolution);

    for (const failure of unresolved) {
      const error = failure.error || "";
      for (const { match, resolution } of KNOWN_PATTERNS) {
        if (match.test(error)) {
          failure.resolution = resolution;
          failure.type = "pattern";
          promoted++;
          this.logger?.info(`[foundry] Auto-promoted pattern: ${error.slice(0, 50)}...`);
          break;
        }
      }
    }

    if (promoted > 0) {
      this.saveLearnings();
    }
    return promoted;
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
    const successEntries = this.learnings.filter((l) => l.type === "success");
    if (successEntries.length > 100) {
      const oldest = successEntries[0];
      this.learnings = this.learnings.filter((l) => l.id !== oldest.id);
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
  // RISE: Sort by improvement trajectory success rate

  findRelevantLearnings(tool?: string, errorPattern?: string): LearningEntry[] {
    const relevant = this.learnings.filter((l) => {
      if (tool && l.tool !== tool) return false;
      if (errorPattern && l.error && !l.error.includes(errorPattern))
        return false;
      return l.type === "pattern" || l.type === "insight";
    });
    // Sort by RISE effectiveness score
    return relevant
      .sort(
        (a, b) => this.calculatePatternScore(b) - this.calculatePatternScore(a),
      )
      .slice(0, 10);
  }

  getRecentFailures(limit = 5): LearningEntry[] {
    return this.learnings
      .filter((l) => l.type === "failure" && !l.resolution)
      .slice(-limit);
  }

  getPatterns(): LearningEntry[] {
    return this.learnings.filter((l) => l.type === "pattern");
  }

  getInsights(): LearningEntry[] {
    return this.learnings.filter((l) => l.type === "insight");
  }

  getLearningsSummary(): string {
    const failures = this.learnings.filter((l) => l.type === "failure").length;
    const patterns = this.learnings.filter((l) => l.type === "pattern").length;
    const crystallized = this.learnings.filter((l) => l.crystallizedTo).length;
    const insights = this.learnings.filter((l) => l.type === "insight").length;
    const successes = this.learnings.filter((l) => l.type === "success").length;
    const pending = this.getCrystallizationCandidates().length;

    return `${patterns} patterns (${crystallized} crystallized, ${pending} pending), ${insights} insights, ${failures} unresolved, ${successes} successes`;
  }

  // ── Pending session management ───────────────────────────────────────────

  savePendingSession(session: Omit<PendingSession, "createdAt">): void {
    this.pendingSession = {
      ...session,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(
      this.pendingSessionPath,
      JSON.stringify(this.pendingSession, null, 2),
    );
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

  // ── Outcome-based Learning ────────────────────────────────────────────────
  // Track real-world feedback signals (e.g., TikTok views, tweet engagement)

  private loadOutcomes(): void {
    try {
      if (existsSync(this.outcomesPath)) {
        this.outcomes = JSON.parse(readFileSync(this.outcomesPath, "utf-8"));
      }
      if (existsSync(this.insightsPath)) {
        const insights = JSON.parse(readFileSync(this.insightsPath, "utf-8"));
        this.taskTypeInsights = new Map(Object.entries(insights));
      }
    } catch (err) {
      this.logger?.warn?.(`[foundry] Failed to load outcomes: ${err}`);
    }
  }

  private saveOutcomes(): void {
    writeFileSync(this.outcomesPath, JSON.stringify(this.outcomes, null, 2));
    writeFileSync(
      this.insightsPath,
      JSON.stringify(Object.fromEntries(this.taskTypeInsights), null, 2),
    );
  }

  // Register a task for outcome tracking
  trackOutcome(
    taskType: string,
    taskDescription: string,
    taskParams: Record<string, any>,
    successThreshold?: Record<string, number>,
  ): string {
    const outcome: TaskOutcome = {
      id: `outcome_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskType,
      taskDescription,
      taskParams,
      executedAt: new Date().toISOString(),
      metrics: {},
      insights: [],
      successThreshold,
    };
    this.outcomes.push(outcome);
    this.saveOutcomes();
    this.logger?.info(
      `[foundry] Tracking outcome: ${taskType} - ${outcome.id}`,
    );
    return outcome.id;
  }

  // Record feedback for a tracked outcome
  recordFeedback(
    outcomeId: string,
    metrics: Record<string, number>,
    feedbackSource: string,
  ): TaskOutcome | null {
    const outcome = this.outcomes.find((o) => o.id === outcomeId);
    if (!outcome) {
      this.logger?.warn?.(`[foundry] Outcome not found: ${outcomeId}`);
      return null;
    }

    outcome.metrics = { ...outcome.metrics, ...metrics };
    outcome.feedbackCollectedAt = new Date().toISOString();
    outcome.feedbackSource = feedbackSource;

    // Determine success based on threshold
    if (outcome.successThreshold) {
      outcome.success = Object.entries(outcome.successThreshold).every(
        ([key, threshold]) => (outcome.metrics[key] || 0) >= threshold,
      );
    }

    this.saveOutcomes();
    this.logger?.info(
      `[foundry] Recorded feedback for ${outcomeId}: ${JSON.stringify(metrics)} (success: ${outcome.success})`,
    );

    // Trigger insight regeneration for this task type
    this.regenerateInsights(outcome.taskType);

    return outcome;
  }

  // Get outcomes pending feedback collection
  getPendingFeedback(taskType?: string): TaskOutcome[] {
    return this.outcomes.filter((o) => {
      if (o.feedbackCollectedAt) return false; // Already collected
      if (taskType && o.taskType !== taskType) return false;
      // Only collect feedback after some time has passed (e.g., 1 hour)
      const executedAt = new Date(o.executedAt).getTime();
      const hourAgo = Date.now() - 60 * 60 * 1000;
      return executedAt < hourAgo;
    });
  }

  // Regenerate insights for a task type based on all outcomes
  regenerateInsights(taskType: string): TaskTypeInsights {
    const typeOutcomes = this.outcomes.filter(
      (o) => o.taskType === taskType && o.feedbackCollectedAt,
    );

    if (typeOutcomes.length === 0) {
      const empty: TaskTypeInsights = {
        taskType,
        totalTasks: 0,
        successfulTasks: 0,
        avgMetrics: {},
        topPerformers: [],
        patterns: { successful: [], unsuccessful: [] },
        recommendations: [],
        lastUpdated: new Date().toISOString(),
      };
      this.taskTypeInsights.set(taskType, empty);
      return empty;
    }

    // Calculate averages
    const avgMetrics: Record<string, number> = {};
    const metricSums: Record<string, { sum: number; count: number }> = {};

    for (const outcome of typeOutcomes) {
      for (const [key, value] of Object.entries(outcome.metrics)) {
        if (!metricSums[key]) metricSums[key] = { sum: 0, count: 0 };
        metricSums[key].sum += value;
        metricSums[key].count += 1;
      }
    }

    for (const [key, { sum, count }] of Object.entries(metricSums)) {
      avgMetrics[key] = Math.round(sum / count);
    }

    // Find top performers (by first metric or 'views' or 'engagement')
    const primaryMetric = Object.keys(avgMetrics)[0] || "views";
    const sorted = [...typeOutcomes].sort(
      (a, b) =>
        (b.metrics[primaryMetric] || 0) - (a.metrics[primaryMetric] || 0),
    );
    const topPerformers = sorted.slice(0, 3);

    // Extract patterns from successful vs unsuccessful
    const successful = typeOutcomes.filter((o) => o.success === true);
    const unsuccessful = typeOutcomes.filter((o) => o.success === false);

    const successfulPatterns = this.extractPatterns(successful);
    const unsuccessfulPatterns = this.extractPatterns(unsuccessful);

    // Generate recommendations
    const recommendations: string[] = [];

    if (topPerformers.length > 0) {
      const topParams = topPerformers[0].taskParams;
      if (topParams.time || topParams.postTime) {
        recommendations.push(
          `Best performing time: ${topParams.time || topParams.postTime}`,
        );
      }
      if (topParams.hashtags) {
        recommendations.push(`Top hashtags: ${topParams.hashtags}`);
      }
      if (topParams.contentType) {
        recommendations.push(`Best content type: ${topParams.contentType}`);
      }
      if (topParams.length || topParams.duration) {
        recommendations.push(
          `Optimal length: ${topParams.length || topParams.duration}`,
        );
      }
    }

    if (successfulPatterns.length > 0) {
      recommendations.push(`Successful pattern: ${successfulPatterns[0]}`);
    }
    if (unsuccessfulPatterns.length > 0) {
      recommendations.push(`Avoid: ${unsuccessfulPatterns[0]}`);
    }

    const insights: TaskTypeInsights = {
      taskType,
      totalTasks: typeOutcomes.length,
      successfulTasks: successful.length,
      avgMetrics,
      topPerformers,
      patterns: {
        successful: successfulPatterns,
        unsuccessful: unsuccessfulPatterns,
      },
      recommendations,
      lastUpdated: new Date().toISOString(),
    };

    // Generate improvement suggestion if patterns are strong enough
    const MIN_SAMPLES_FOR_IMPROVEMENT = 5;
    const MIN_SUCCESS_RATE_FOR_CONFIDENCE = 0.6;

    if (typeOutcomes.length >= MIN_SAMPLES_FOR_IMPROVEMENT) {
      const successRate = successful.length / typeOutcomes.length;
      const confidence = Math.min(
        successRate * (typeOutcomes.length / 10), // More samples = higher confidence
        1.0,
      );

      if (confidence >= 0.5 && successfulPatterns.length > 0) {
        // Generate suggested changes based on successful patterns
        const suggestedChanges: string[] = [];

        // Parse patterns into actionable changes
        for (const pattern of successfulPatterns.slice(0, 3)) {
          const match = pattern.match(/^(\w+):\s*(.+?)\s*\(/);
          if (match) {
            const [, param, value] = match;
            suggestedChanges.push(`Set default ${param} to "${value}"`);
          }
        }

        // Add recommendations as changes
        for (const rec of recommendations.slice(0, 2)) {
          if (rec.includes(":")) {
            suggestedChanges.push(rec);
          }
        }

        if (suggestedChanges.length > 0) {
          // Try to infer target skill from task type
          const targetSkill = this.inferSkillFromTaskType(taskType);

          insights.improvementSuggestion = {
            confidence,
            targetSkill,
            suggestedChanges,
          };

          this.logger?.info(
            `[foundry] Generated improvement suggestion for ${taskType} (confidence: ${(confidence * 100).toFixed(0)}%): ${suggestedChanges.length} changes`,
          );
        }
      }
    }

    this.taskTypeInsights.set(taskType, insights);
    this.saveOutcomes();
    this.logger?.info(
      `[foundry] Regenerated insights for ${taskType}: ${insights.recommendations.length} recommendations`,
    );

    return insights;
  }

  // Extract common patterns from a set of outcomes
  private extractPatterns(outcomes: TaskOutcome[]): string[] {
    if (outcomes.length < 2) return [];

    const patterns: string[] = [];
    const paramCounts: Record<string, Record<string, number>> = {};

    // Count occurrences of each param value
    for (const outcome of outcomes) {
      for (const [key, value] of Object.entries(outcome.taskParams)) {
        if (!paramCounts[key]) paramCounts[key] = {};
        const strValue =
          typeof value === "string" ? value : JSON.stringify(value);
        paramCounts[key][strValue] = (paramCounts[key][strValue] || 0) + 1;
      }
    }

    // Find params that appear in >50% of outcomes
    const threshold = outcomes.length * 0.5;
    for (const [param, valueCounts] of Object.entries(paramCounts)) {
      for (const [value, count] of Object.entries(valueCounts)) {
        if (count >= threshold) {
          patterns.push(
            `${param}: ${value} (${Math.round((count / outcomes.length) * 100)}%)`,
          );
        }
      }
    }

    return patterns.slice(0, 5); // Limit to top 5 patterns
  }

  // Get insights for a task type
  getTaskInsights(taskType: string): TaskTypeInsights | null {
    return this.taskTypeInsights.get(taskType) || null;
  }

  // Get all task types with insights
  getAllTaskTypes(): string[] {
    return Array.from(this.taskTypeInsights.keys());
  }

  // Get insights formatted for injection into agent context
  getInsightsForContext(taskType: string): string {
    const insights = this.taskTypeInsights.get(taskType);
    if (!insights || insights.totalTasks === 0) {
      return "";
    }

    let context = `\n## 📊 Learned Insights: ${taskType}\n\n`;
    context += `Based on ${insights.totalTasks} tracked outcomes (${insights.successfulTasks} successful):\n\n`;

    if (insights.avgMetrics && Object.keys(insights.avgMetrics).length > 0) {
      context += `**Average metrics**: ${Object.entries(insights.avgMetrics)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")}\n\n`;
    }

    if (insights.recommendations.length > 0) {
      context += `**Recommendations**:\n`;
      for (const rec of insights.recommendations) {
        context += `- ${rec}\n`;
      }
      context += "\n";
    }

    if (insights.patterns.successful.length > 0) {
      context += `**What works**: ${insights.patterns.successful.slice(0, 3).join("; ")}\n`;
    }

    if (insights.patterns.unsuccessful.length > 0) {
      context += `**What to avoid**: ${insights.patterns.unsuccessful.slice(0, 2).join("; ")}\n`;
    }

    return context;
  }

  // Start periodic feedback collection
  startFeedbackCollection(
    collectFn: (outcome: TaskOutcome) => Promise<Record<string, number> | null>,
    intervalMs = 60 * 60 * 1000, // default: 1 hour
  ): void {
    if (this.feedbackCollectionInterval) return;

    this.feedbackCollectionInterval = setInterval(async () => {
      const pending = this.getPendingFeedback();
      this.logger?.info(
        `[foundry] Checking feedback for ${pending.length} pending outcomes`,
      );

      for (const outcome of pending) {
        try {
          const metrics = await collectFn(outcome);
          if (metrics) {
            this.recordFeedback(outcome.id, metrics, "auto_collection");
          }
        } catch (err) {
          this.logger?.warn?.(
            `[foundry] Failed to collect feedback for ${outcome.id}: ${err}`,
          );
        }
      }
    }, intervalMs);

    this.logger?.info(
      `[foundry] Feedback collection started (interval: ${intervalMs}ms)`,
    );
  }

  stopFeedbackCollection(): void {
    if (this.feedbackCollectionInterval) {
      clearInterval(this.feedbackCollectionInterval);
      this.feedbackCollectionInterval = null;
    }
  }

  // Get all outcomes for a task type
  getOutcomes(taskType?: string): TaskOutcome[] {
    if (taskType) {
      return this.outcomes.filter((o) => o.taskType === taskType);
    }
    return this.outcomes;
  }

  // Infer which skill should be modified based on task type
  private inferSkillFromTaskType(taskType: string): string | undefined {
    // Common mappings from task type to skill name
    const mappings: Record<string, string> = {
      tiktok_post: "tiktok",
      tiktok_video: "tiktok",
      tweet: "twitter",
      twitter_post: "twitter",
      linkedin_post: "linkedin",
      instagram_post: "instagram",
      email_campaign: "email",
      blog_post: "blog",
      youtube_video: "youtube",
    };

    const normalized = taskType.toLowerCase().replace(/[^a-z_]/g, "");
    return mappings[normalized];
  }

  // Get improvement suggestions that should be surfaced to the agent
  getImprovementSuggestions(): Array<{
    taskType: string;
    suggestion: NonNullable<TaskTypeInsights["improvementSuggestion"]>;
  }> {
    const suggestions: Array<{
      taskType: string;
      suggestion: NonNullable<TaskTypeInsights["improvementSuggestion"]>;
    }> = [];

    for (const [taskType, insights] of this.taskTypeInsights) {
      if (
        insights.improvementSuggestion &&
        insights.improvementSuggestion.confidence >= 0.5 &&
        !insights.improvementSuggestion.appliedAt
      ) {
        suggestions.push({
          taskType,
          suggestion: insights.improvementSuggestion,
        });
      }
    }

    return suggestions.sort(
      (a, b) => b.suggestion.confidence - a.suggestion.confidence,
    );
  }

  // Mark an improvement as applied
  markImprovementApplied(taskType: string): void {
    const insights = this.taskTypeInsights.get(taskType);
    if (insights?.improvementSuggestion) {
      insights.improvementSuggestion.appliedAt = new Date().toISOString();
      this.taskTypeInsights.set(taskType, insights);
      this.saveOutcomes();
      this.logger?.info(`[foundry] Marked improvement applied for ${taskType}`);
    }
  }

  // ── Workflow Learning ─────────────────────────────────────────────────────

  private loadWorkflows(): void {
    if (existsSync(this.workflowsPath)) {
      try {
        this.workflows = JSON.parse(readFileSync(this.workflowsPath, "utf-8"));
      } catch {
        this.workflows = [];
      }
    }
    if (existsSync(this.workflowPatternsPath)) {
      try {
        const data = JSON.parse(
          readFileSync(this.workflowPatternsPath, "utf-8"),
        );
        this.workflowPatterns = new Map(Object.entries(data));
      } catch {
        this.workflowPatterns = new Map();
      }
    }
  }

  private saveWorkflows(): void {
    writeFileSync(this.workflowsPath, JSON.stringify(this.workflows, null, 2));
    const patternsObj = Object.fromEntries(this.workflowPatterns);
    writeFileSync(
      this.workflowPatternsPath,
      JSON.stringify(patternsObj, null, 2),
    );
  }

  // Start tracking a new workflow when user sends first message
  startWorkflow(goal: string): void {
    this.currentWorkflow = {
      goal,
      tools: [],
      startedAt: Date.now(),
    };
    this.logger?.info(
      `[foundry] Started tracking workflow: ${goal.slice(0, 50)}...`,
    );
  }

  // Track tool call within current workflow
  trackWorkflowTool(toolName: string): void {
    if (this.currentWorkflow && !toolName.startsWith("foundry_")) {
      this.currentWorkflow.tools.push(toolName);
    }
  }

  // Complete and record the workflow
  completeWorkflow(
    outcome: "success" | "failure" | "partial",
    context: string,
  ): void {
    if (!this.currentWorkflow || this.currentWorkflow.tools.length < 2) {
      this.currentWorkflow = null;
      return;
    }

    const entry: WorkflowEntry = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      goal: this.currentWorkflow.goal,
      toolSequence: this.currentWorkflow.tools,
      startedAt: this.currentWorkflow.startedAt,
      completedAt: Date.now(),
      outcome,
      context,
    };

    this.workflows.push(entry);
    this.logger?.info(
      `[foundry] Recorded workflow: ${entry.toolSequence.length} tools, outcome=${outcome}`,
    );

    // Update patterns
    this.updateWorkflowPatterns(entry);
    this.saveWorkflows();
    this.currentWorkflow = null;
  }

  // Create normalized signature from tool sequence
  private createWorkflowSignature(tools: string[]): string {
    return tools.slice(0, 10).join("→");
  }

  // Extract keywords from goal text
  private extractGoalKeywords(goal: string): string[] {
    const stopWords = new Set([
      "a",
      "an",
      "the",
      "to",
      "for",
      "of",
      "and",
      "or",
      "in",
      "on",
      "with",
      "is",
      "it",
      "i",
      "me",
      "my",
      "can",
      "you",
      "please",
      "want",
      "need",
      "help",
    ]);
    return goal
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 10);
  }

  // Update workflow patterns after recording a workflow
  private updateWorkflowPatterns(entry: WorkflowEntry): void {
    const signature = this.createWorkflowSignature(entry.toolSequence);
    const existing = this.workflowPatterns.get(signature);
    const keywords = this.extractGoalKeywords(entry.goal);

    if (existing) {
      // Update existing pattern
      existing.occurrences++;
      existing.lastOccurrence = Date.now();
      const successCount =
        existing.successRate * (existing.occurrences - 1) +
        (entry.outcome === "success" ? 1 : 0);
      existing.successRate = successCount / existing.occurrences;
      existing.avgDuration =
        (existing.avgDuration * (existing.occurrences - 1) +
          (entry.completedAt - entry.startedAt)) /
        existing.occurrences;
      // Merge keywords
      const keywordSet = new Set([...existing.goalKeywords, ...keywords]);
      existing.goalKeywords = Array.from(keywordSet).slice(0, 20);
      this.workflowPatterns.set(signature, existing);
    } else {
      // Create new pattern
      const pattern: WorkflowPattern = {
        id: `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        signature,
        goalKeywords: keywords,
        occurrences: 1,
        successRate: entry.outcome === "success" ? 1 : 0,
        avgDuration: entry.completedAt - entry.startedAt,
        lastOccurrence: Date.now(),
      };
      this.workflowPatterns.set(signature, pattern);
    }
  }

  // Find workflow patterns that match user's goal
  findMatchingWorkflows(userMessage: string): WorkflowSuggestion[] {
    const userKeywords = this.extractGoalKeywords(userMessage);
    if (userKeywords.length === 0) return [];

    const suggestions: WorkflowSuggestion[] = [];

    for (const pattern of this.workflowPatterns.values()) {
      // Only suggest patterns with enough occurrences and good success rate
      if (
        pattern.occurrences < 3 ||
        pattern.successRate < 0.5 ||
        pattern.crystallizedTo
      )
        continue;

      // Calculate keyword overlap
      const overlap = userKeywords.filter((k) =>
        pattern.goalKeywords.includes(k),
      ).length;
      if (overlap === 0) continue;

      const confidence =
        (overlap / userKeywords.length) *
        pattern.successRate *
        Math.min(pattern.occurrences / 5, 1);
      if (confidence < 0.3) continue;

      suggestions.push({
        patternId: pattern.id,
        signature: pattern.signature,
        description: `You've done "${pattern.signature}" ${pattern.occurrences}x (${(pattern.successRate * 100).toFixed(0)}% success) when working with: ${pattern.goalKeywords.slice(0, 5).join(", ")}`,
        confidence,
      });
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  // Get patterns ready for crystallization (convert to a single tool)
  getWorkflowCrystallizationCandidates(): WorkflowPattern[] {
    return Array.from(this.workflowPatterns.values()).filter(
      (p) => p.occurrences >= 5 && p.successRate >= 0.7 && !p.crystallizedTo,
    );
  }

  // Mark a workflow pattern as crystallized into a tool
  markWorkflowCrystallized(patternId: string, toolId: string): void {
    for (const pattern of this.workflowPatterns.values()) {
      if (pattern.id === patternId) {
        pattern.crystallizedTo = toolId;
        this.saveWorkflows();
        this.logger?.info(
          `[foundry] Workflow pattern ${patternId} crystallized to tool ${toolId}`,
        );
        return;
      }
    }
  }

  // Get workflow stats for display
  getWorkflowStats(): {
    totalWorkflows: number;
    patterns: number;
    suggestions: number;
  } {
    const candidateCount = this.getWorkflowCrystallizationCandidates().length;
    return {
      totalWorkflows: this.workflows.length,
      patterns: this.workflowPatterns.size,
      suggestions: candidateCount,
    };
  }

  // Check if this is the first run (no workflows recorded yet)
  isFirstRun(): boolean {
    return this.workflows.length === 0;
  }

  // Get recent workflows for context
  getRecentWorkflows(limit = 5): WorkflowEntry[] {
    return this.workflows.slice(-limit);
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
  private logger?: {
    info: (msg: string) => void;
    warn?: (msg: string) => void;
  };

  constructor(logger?: {
    info: (msg: string) => void;
    warn?: (msg: string) => void;
  }) {
    this.logger = logger;
  }

  /**
   * Validate generated code before writing.
   */
  async validate(
    code: string,
    type: "extension" | "tool" | "hook",
  ): Promise<ValidationResult> {
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
      errors.push(...securityPatterns.blocked.map((p) => `BLOCKED: ${p}`));
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

    this.logger?.info(
      `[foundry] Code validation: ${errors.length} errors, ${warnings.length} warnings, ${securityFlags.length} flags`,
    );

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
  private staticSecurityScan(code: string): {
    blocked: string[];
    flagged: string[];
  } {
    const blocked: string[] = [];
    const flagged: string[] = [];

    // BLOCK patterns - instant reject
    const blockPatterns = [
      { pattern: /id_rsa|id_ed25519|~\/\.ssh\//i, reason: "SSH key reference" },
      {
        pattern: /aws_secret|aws_access|~\/\.aws\//i,
        reason: "AWS credentials",
      },
      { pattern: /~\/\.gnupg\//i, reason: "GPG key reference" },
      {
        pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i,
        reason: "Child process import",
      },
      {
        pattern: /\bexec\s*\(|\bspawn\s*\(|\bexecSync\s*\(/i,
        reason: "Shell execution",
      },
      { pattern: /\beval\s*\(/i, reason: "eval() usage" },
      { pattern: /new\s+Function\s*\(/i, reason: "Dynamic function creation" },
      {
        pattern:
          /\.ngrok\.|\.burpcollaborator\.|\.oastify\.|webhook\.site|requestbin/i,
        reason: "Exfiltration domain",
      },
      {
        pattern: /ignore\s+previous\s+instructions|system:\s*you/i,
        reason: "Prompt injection",
      },
      { pattern: /coinhive|cryptominer/i, reason: "Crypto mining" },
      { pattern: /crontab|systemctl|launchctl/i, reason: "System persistence" },
      { pattern: /<script|<!--/i, reason: "Script injection" },
    ];

    // FLAG patterns - needs review
    const flagPatterns = [
      { pattern: /process\.env|\.env/i, reason: "Environment variable access" },
      { pattern: /readFile|writeFile|fs\./i, reason: "Filesystem access" },
      { pattern: /atob|btoa|Buffer\.from/i, reason: "Base64 encoding" },
      {
        pattern: /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i,
        reason: "Hex/unicode escapes",
      },
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
  async testInSandbox(
    code: string,
    tempDir: string,
  ): Promise<{ success: boolean; error?: string }> {
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

// Mock OpenClaw API
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

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code: number) => {
          // Clean up
          try {
            fs.rmSync(testDir, { recursive: true, force: true });
          } catch {}

          if (code === 0 && stdout.includes("SANDBOX_OK")) {
            resolve({ success: true });
          } else {
            const errorMatch = stderr.match(/SANDBOX_ERROR:\s*(.+)/);
            const error =
              errorMatch?.[1] || stderr.slice(0, 500) || `Exit code ${code}`;
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
  return s
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function toMethodName(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith("{")) return "By" + toPascalCase(p.slice(1, -1));
      return toPascalCase(p);
    });
  return method.toLowerCase() + parts.join("");
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  id: "foundry-openclaw",
  name: "Foundry",
  description:
    "Self-writing coding subagent — researches and implements capabilities",

  register(api: ClawdbotPluginApi) {
    const logger = api.logger;
    const cfg = api.pluginConfig || {};
    const dataDir =
      (cfg as any).dataDir || join(homedir(), ".openclaw", "foundry");
    const openclawPath =
      (cfg as any).openclawPath || "/Users/lekt9/Projects/aiko/openclaw";

    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const writer = new CodeWriter(dataDir, openclawPath, logger);
    const docsFetcher = new DocsFetcher();
    const learningEngine = new LearningEngine(dataDir, logger);
    const codeValidator = new CodeValidator(logger);

    // Track current failure for resolution matching
    let lastFailureId: string | null = null;
    // RISE: Track pattern used for injection (to detect successful retries)
    let lastInjectedPatternId: string | null = null;
    let lastInjectedForTool: string | null = null;
    // Track failures per extension/skill ID for learning resolution
    const pendingFailures = new Map<string, { failureId: string; error: string; timestamp: number }>();

    // ── Tools ───────────────────────────────────────────────────────────────

    const tools = (_ctx: ClawdbotPluginToolContext) => {
      const toolList = [
        // ── foundry_research ──────────────────────────────────────────────────
        {
          name: "foundry_research",
          label: "Research Documentation",
          description:
            "Search docs.openclaw.ai for best practices. Use before implementing to understand " +
            "the OpenClaw API, patterns, and conventions.",
          parameters: {
            type: "object" as const,
            properties: {
              query: {
                type: "string" as const,
                description:
                  "What to research (e.g., 'how to write hooks', 'browser automation', 'skill structure')",
              },
              topic: {
                type: "string" as const,
                enum: [
                  "plugin",
                  "hooks",
                  "tools",
                  "browser",
                  "skills",
                  "agent",
                  "gateway",
                  "channels",
                  "memory",
                  "models",
                  "automation",
                  "nodes",
                  "security",
                ],
                description:
                  "Specific topic to fetch docs for (optional, faster than query)",
              },
              page: {
                type: "string" as const,
                description:
                  "Specific doc page path (e.g., '/tools/plugin', '/automation/hooks')",
              },
            },
            required: [],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              query?: string;
              topic?: string;
              page?: string;
            };

            let content: string;

            if (p.page) {
              content = await docsFetcher.fetchPage(p.page);
            } else if (p.topic) {
              content = await docsFetcher.fetchForTopic(p.topic);
            } else if (p.query) {
              content = await docsFetcher.search(p.query);
            } else {
              content =
                `## Available Documentation Topics\n\n` +
                Object.entries(DOC_PAGES)
                  .map(
                    ([topic, pages]) => `- **${topic}**: ${pages.join(", ")}`,
                  )
                  .join("\n") +
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
                description:
                  "What capability to implement (e.g., 'OAuth token refresh', 'rate limiting', 'webhook handler')",
              },
              type: {
                type: "string" as const,
                enum: ["extension", "skill", "tool", "hook"],
                description:
                  "What to create: extension (full plugin), skill (API client), tool (single tool), hook (event handler)",
              },
              targetExtension: {
                type: "string" as const,
                description: "For tool/hook: which extension to add it to",
              },
            },
            required: ["capability", "type"],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              capability: string;
              type: string;
              targetExtension?: string;
            };

            // Build context from platform docs
            let context = `## Implementation: ${p.capability}\n\n`;
            context += `**Type**: ${p.type}\n\n`;

            // Fetch relevant docs
            try {
              const relevantTopics: string[] = [];
              if (p.type === "extension" || p.type === "tool")
                relevantTopics.push("plugin");
              if (p.type === "hook" || p.type === "extension")
                relevantTopics.push("hooks");
              if (p.type === "skill") relevantTopics.push("skills");

              for (const topic of relevantTopics) {
                const topicDocs = await docsFetcher.fetchForTopic(topic);
                context += `### ${topic.charAt(0).toUpperCase() + topic.slice(1)} API\n\n`;
                context += topicDocs.slice(0, 2000) + "\n\n";
              }
            } catch (err) {
              const docs = writer.getDocs();
              if (docs.plugin) {
                context += `### Plugin API (local)\n\n`;
                context += docs.plugin.slice(0, 3000) + "\n\n";
              }
            }

            // Implementation guidance
            context += `## Implementation Guide\n\n`;

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
                  return {
                    content: [
                      {
                        type: "text",
                        text: "Error: targetExtension required for type=tool",
                      },
                    ],
                  };
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
                  return {
                    content: [
                      {
                        type: "text",
                        text: "Error: targetExtension required for type=hook",
                      },
                    ],
                  };
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
          description:
            "Write a new OpenClaw extension to ~/.openclaw/extensions/. Use foundry_restart to load and resume.",
          parameters: {
            type: "object" as const,
            properties: {
              id: {
                type: "string" as const,
                description: "Extension ID (kebab-case)",
              },
              name: {
                type: "string" as const,
                description: "Human-readable name",
              },
              description: {
                type: "string" as const,
                description: "What this extension does",
              },
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
                    required: {
                      type: "array" as const,
                      items: { type: "string" as const },
                    },
                    code: {
                      type: "string" as const,
                      description: "Execute function body",
                    },
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
              code:
                t.code ||
                "return { content: [{ type: 'text', text: 'Not implemented' }] };",
            }));

            const hooks: HookDef[] = (p.hooks || []).map((h: any) => ({
              event: h.event,
              code: h.code || "// No-op",
            }));

            try {
              const { path: extDir, validation } = await writer.writeExtension(
                {
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  tools,
                  hooks,
                },
                codeValidator,
              );

              let output =
                `## Extension Written\n\n` +
                `**${p.name}** (\`${p.id}\`)\n\n` +
                `- Location: \`${extDir}\`\n` +
                `- Tools: ${tools.length}\n` +
                `- Hooks: ${hooks.length}\n`;

              if (validation.warnings.length > 0) {
                output += `\n**Warnings:**\n${validation.warnings.map((w) => `- ${w}`).join("\n")}\n`;
              }
              if (validation.securityFlags.length > 0) {
                output += `\n**Security flags (review recommended):**\n${validation.securityFlags.map((f) => `- ${f}`).join("\n")}\n`;
              }

              // Link success to previous failure → create pattern
              const pendingKey = `ext:${p.id}`;
              const pending = pendingFailures.get(pendingKey);
              if (pending) {
                // Create pattern: failure error → successful code approach
                const resolution = `Fixed by: ${tools.map(t => t.name).join(", ")} tools, avoiding: ${pending.error.slice(0, 100)}`;
                learningEngine.recordResolution(pending.failureId, resolution);
                pendingFailures.delete(pendingKey);
                logger.info(`[foundry] Learned pattern from ${p.id}: ${pending.error.slice(0, 50)}...`);
                output += `\n**Learned**: Pattern created from previous failure.\n`;
              }

              output += `\n**Next**: Call \`foundry_restart\` to reload gateway and auto-resume this conversation.`;

              return { content: [{ type: "text", text: output }] };
            } catch (err: any) {
              // SelfEvolve (arXiv:2306.02907): Return structured feedback for LLM refinement
              const errorMsg = err.message || String(err);
              const isSandboxError = errorMsg.includes("Sandbox");
              const isValidationError = errorMsg.includes("validation");

              // Record the failure for learning
              const failureId = learningEngine.recordFailure(
                "foundry_write_extension",
                errorMsg,
                `Extension: ${p.id}, Tools: ${tools.length}, Hooks: ${hooks.length}`,
                isSandboxError ? "sandbox_runtime_error" : "validation_error",
              );
              // Track for resolution linking when extension succeeds later
              pendingFailures.set(`ext:${p.id}`, { failureId, error: errorMsg, timestamp: Date.now() });

              // Build detailed feedback for the LLM to self-correct
              let feedback = `## Extension FAILED - SelfEvolve Feedback\n\n`;
              feedback += `**Extension**: ${p.name} (\`${p.id}\`)\n\n`;
              feedback += `### Error Type\n`;
              feedback += isSandboxError
                ? `**Runtime Error** - The code compiled but failed during execution.\n`
                : `**Validation Error** - The code failed static analysis.\n`;
              feedback += `\n### Error Details\n\`\`\`\n${errorMsg}\n\`\`\`\n\n`;

              // Provide specific guidance based on error type
              feedback += `### How to Fix\n`;
              if (isSandboxError) {
                feedback += `1. Check for undefined variables or missing imports\n`;
                feedback += `2. Ensure all async functions are properly awaited\n`;
                feedback += `3. Verify the code handles edge cases (null, undefined, empty)\n`;
                feedback += `4. Check that external dependencies are available\n`;
              } else if (isValidationError) {
                feedback += `1. Review the validation rules in the error message\n`;
                feedback += `2. Remove any blocked patterns (dangerous code, etc.)\n`;
                feedback += `3. Ensure proper types and structure\n`;
              }

              feedback += `\n### Retry Instructions\n`;
              feedback += `Fix the issues above and call \`foundry_write_extension\` again with corrected code.\n`;
              feedback += `The code should be self-contained and not rely on external state.\n`;

              return { content: [{ type: "text", text: feedback }] };
            }
          },
        },

        // ── foundry_write_skill (OpenClaw/AgentSkills-compatible) ───────────────
        {
          name: "foundry_write_skill",
          label: "Write Skill",
          description:
            "Write an OpenClaw/AgentSkills-compatible skill (SKILL.md) to ~/.openclaw/skills/. Supports both general skills and API-based skills.",
          parameters: {
            type: "object" as const,
            properties: {
              name: {
                type: "string" as const,
                description:
                  "Skill name (kebab-case recommended, e.g., 'my-skill')",
              },
              description: {
                type: "string" as const,
                description: "What this skill does (appears in frontmatter)",
              },
              content: {
                type: "string" as const,
                description:
                  "Markdown content for the skill (after frontmatter)",
              },
              // OpenClaw frontmatter options
              homepage: {
                type: "string" as const,
                description: "URL for skill documentation/website",
              },
              userInvocable: {
                type: "boolean" as const,
                description:
                  "Whether skill is exposed as user slash command (default: true)",
              },
              disableModelInvocation: {
                type: "boolean" as const,
                description: "Exclude from model prompt (default: false)",
              },
              commandDispatch: {
                type: "string" as const,
                enum: ["tool"],
                description: "Bypass model and dispatch directly to tool",
              },
              commandTool: {
                type: "string" as const,
                description: "Tool name when command-dispatch is 'tool'",
              },
              commandArgMode: {
                type: "string" as const,
                enum: ["raw"],
                description: "How to forward args to tool",
              },
              metadata: {
                type: "object" as const,
                description:
                  "OpenClaw metadata for gating (requires.bins, requires.env, etc.)",
                properties: {
                  openclaw: {
                    type: "object" as const,
                    properties: {
                      always: {
                        type: "boolean" as const,
                        description: "Always include skill (skip gates)",
                      },
                      emoji: {
                        type: "string" as const,
                        description: "Emoji for macOS Skills UI",
                      },
                      homepage: {
                        type: "string" as const,
                        description: "URL for macOS Skills UI",
                      },
                      os: {
                        type: "array" as const,
                        items: {
                          type: "string" as const,
                          enum: ["darwin", "linux", "win32"],
                        },
                      },
                      primaryEnv: {
                        type: "string" as const,
                        description: "Env var for apiKey mapping",
                      },
                      skillKey: {
                        type: "string" as const,
                        description: "Config key override",
                      },
                      requires: {
                        type: "object" as const,
                        properties: {
                          bins: {
                            type: "array" as const,
                            items: { type: "string" as const },
                            description: "Required binaries on PATH",
                          },
                          anyBins: {
                            type: "array" as const,
                            items: { type: "string" as const },
                            description: "At least one required",
                          },
                          env: {
                            type: "array" as const,
                            items: { type: "string" as const },
                            description: "Required env vars",
                          },
                          config: {
                            type: "array" as const,
                            items: { type: "string" as const },
                            description: "Required config paths",
                          },
                        },
                      },
                    },
                  },
                },
              },
              // Legacy API-based skill support
              baseUrl: {
                type: "string" as const,
                description: "(Legacy) API base URL for API-based skills",
              },
              endpoints: {
                type: "array" as const,
                description: "(Legacy) API endpoints for API-based skills",
                items: {
                  type: "object" as const,
                  properties: {
                    method: {
                      type: "string" as const,
                      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
                    },
                    path: {
                      type: "string" as const,
                      description: "Path with {param} placeholders",
                    },
                    description: { type: "string" as const },
                  },
                },
              },
              authHeaders: {
                type: "object" as const,
                description: "(Legacy) Auth headers for API-based skills",
              },
            },
            required: ["name", "description"],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as any;

            const skillDir = writer.writeSkill({
              name: p.name,
              description: p.description,
              content: p.content,
              homepage: p.homepage,
              userInvocable: p.userInvocable,
              disableModelInvocation: p.disableModelInvocation,
              commandDispatch: p.commandDispatch,
              commandTool: p.commandTool,
              commandArgMode: p.commandArgMode,
              metadata: p.metadata,
              baseUrl: p.baseUrl,
              endpoints: p.endpoints,
              authHeaders: p.authHeaders,
            });

            const isApiSkill = p.baseUrl && p.endpoints?.length > 0;
            let summary =
              `## Skill Written (OpenClaw-compatible)\n\n` +
              `**${p.name}**\n\n` +
              `- Location: \`${skillDir}\`\n` +
              `- Format: AgentSkills/OpenClaw SKILL.md\n`;

            if (isApiSkill) {
              summary +=
                `- Type: API-based skill\n` +
                `- Base URL: \`${p.baseUrl}\`\n` +
                `- Endpoints: ${p.endpoints.length}\n`;
            } else {
              summary += `- Type: General skill\n`;
            }

            if (p.metadata?.openclaw?.requires) {
              const req = p.metadata.openclaw.requires;
              if (req.bins?.length)
                summary += `- Required bins: ${req.bins.join(", ")}\n`;
              if (req.env?.length)
                summary += `- Required env: ${req.env.join(", ")}\n`;
              if (req.config?.length)
                summary += `- Required config: ${req.config.join(", ")}\n`;
            }

            summary += `\nSkill is ready. Restart gateway or start new session to load.`;

            return { content: [{ type: "text", text: summary }] };
          },
        },

        // ── foundry_write_browser_skill ─────────────────────────────────────────
        {
          name: "foundry_write_browser_skill",
          label: "Write Browser Skill",
          description:
            "Write a browser automation skill that uses the OpenClaw browser tool. Automatically gates on browser.enabled config.",
          parameters: {
            type: "object" as const,
            properties: {
              name: {
                type: "string" as const,
                description: "Skill name (kebab-case, e.g., 'twitter-poster')",
              },
              description: {
                type: "string" as const,
                description: "What this skill automates",
              },
              targetUrl: {
                type: "string" as const,
                description: "Primary URL this skill interacts with",
              },
              actions: {
                type: "array" as const,
                description: "Documented browser actions",
                items: {
                  type: "object" as const,
                  properties: {
                    name: {
                      type: "string" as const,
                      description: "Action name (e.g., 'Post Tweet')",
                    },
                    description: {
                      type: "string" as const,
                      description: "What this action does",
                    },
                    steps: {
                      type: "array" as const,
                      items: { type: "string" as const },
                      description: "Step-by-step instructions",
                    },
                  },
                },
              },
              authMethod: {
                type: "string" as const,
                enum: ["manual", "cookie", "header", "oauth"],
                description: "How authentication is handled",
              },
              authNotes: {
                type: "string" as const,
                description: "Additional auth instructions",
              },
              content: {
                type: "string" as const,
                description: "Additional markdown content",
              },
              metadata: {
                type: "object" as const,
                description: "Additional OpenClaw metadata",
              },
            },
            required: ["name", "description"],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as any;

            const skillDir = writer.writeBrowserSkill({
              name: p.name,
              description: p.description,
              targetUrl: p.targetUrl,
              actions: p.actions,
              authMethod: p.authMethod,
              authNotes: p.authNotes,
              content: p.content,
              metadata: p.metadata,
            });

            let summary =
              `## Browser Skill Written\n\n` +
              `**${p.name}**\n\n` +
              `- Location: \`${skillDir}\`\n` +
              `- Type: Browser automation skill\n` +
              `- Target: ${p.targetUrl || "Not specified"}\n` +
              `- Auth: ${p.authMethod || "none"}\n` +
              `- Gated on: \`browser.enabled\` config\n`;

            if (p.actions?.length) {
              summary += `- Actions: ${p.actions.map((a: any) => a.name).join(", ")}\n`;
            }

            summary += `\nSkill is ready. Enable browser in config and restart gateway to use.`;

            return { content: [{ type: "text", text: summary }] };
          },
        },

        // ── foundry_write_hook ──────────────────────────────────────────────────
        {
          name: "foundry_write_hook",
          label: "Write Hook",
          description:
            "Write a standalone OpenClaw hook (HOOK.md + handler.ts) to ~/.openclaw/hooks/. Hooks trigger on events like command:new, gateway:startup, etc.",
          parameters: {
            type: "object" as const,
            properties: {
              name: {
                type: "string" as const,
                description: "Hook name (kebab-case, e.g., 'welcome-message')",
              },
              description: {
                type: "string" as const,
                description: "What this hook does",
              },
              events: {
                type: "array" as const,
                items: {
                  type: "string" as const,
                  enum: [
                    "command:new",
                    "command:reset",
                    "command:stop",
                    "agent:bootstrap",
                    "gateway:startup",
                    "tool_result_persist",
                  ],
                },
                description: "Events that trigger this hook",
              },
              code: {
                type: "string" as const,
                description:
                  "Handler code (TypeScript). Should define a `handler` const of type HookHandler.",
              },
              metadata: {
                type: "object" as const,
                description: "OpenClaw metadata (emoji, requires, etc.)",
              },
            },
            required: ["name", "description", "events"],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as any;

            const hookDir = writer.writeHook({
              name: p.name,
              description: p.description,
              events: p.events,
              code: p.code,
              metadata: p.metadata,
            });

            const summary =
              `## Hook Written\n\n` +
              `**${p.name}**\n\n` +
              `- Location: \`${hookDir}\`\n` +
              `- Events: ${p.events.join(", ")}\n` +
              `- Files: HOOK.md, handler.ts\n\n` +
              `Enable with: \`openclaw hooks enable ${p.name}\``;

            return { content: [{ type: "text", text: summary }] };
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
              extensionId: {
                type: "string" as const,
                description: "Extension to add tool to",
              },
              name: {
                type: "string" as const,
                description: "Tool name (snake_case)",
              },
              label: { type: "string" as const, description: "Display label" },
              description: {
                type: "string" as const,
                description: "What the tool does",
              },
              properties: {
                type: "object" as const,
                description: "Input properties",
              },
              required: {
                type: "array" as const,
                items: { type: "string" as const },
              },
              code: {
                type: "string" as const,
                description: "Execute function body",
              },
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
              return {
                content: [
                  {
                    type: "text",
                    text: `Extension "${p.extensionId}" not found.`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Added tool **${p.name}** to **${p.extensionId}**.\n\nCall \`foundry_restart\` to load and resume.`,
                },
              ],
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
              extensionId: {
                type: "string" as const,
                description: "Extension to add hook to",
              },
              event: {
                type: "string" as const,
                enum: [
                  "before_agent_start",
                  "after_tool_call",
                  "before_tool_call",
                  "agent_end",
                ],
                description: "Hook event",
              },
              code: {
                type: "string" as const,
                description: "Handler function body",
              },
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
              return {
                content: [
                  {
                    type: "text",
                    text: `Extension "${p.extensionId}" not found.`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Added **${p.event}** hook to **${p.extensionId}**.\n\nCall \`foundry_restart\` to load and resume.`,
                },
              ],
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
              showCode: {
                type: "boolean" as const,
                description: "Show generated code",
              },
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
              output += `- Tools: ${ext.tools.map((t) => t.name).join(", ") || "none"}\n`;
              output += `- Hooks: ${ext.hooks.map((h) => h.event).join(", ") || "none"}\n`;
              output += `- Created: ${ext.createdAt}\n\n`;

              if (p.showCode) {
                const codePath = join(
                  homedir(),
                  ".openclaw",
                  "extensions",
                  ext.id,
                  "index.ts",
                );
                if (existsSync(codePath)) {
                  output +=
                    "```typescript\n" +
                    readFileSync(codePath, "utf-8").slice(0, 2000) +
                    "\n```\n\n";
                }
              }
            }

            output += `### Skills (${skills.length})\n\n`;
            for (const skill of skills) {
              output += `**${skill.name}**\n`;
              if (skill.baseUrl) {
                output += `- Base URL: \`${skill.baseUrl}\`\n`;
                output += `- Endpoints: ${skill.endpoints?.length ?? 0}\n`;
              }
              output += `- Created: ${skill.createdAt}\n\n`;
            }

            if (extensions.length === 0 && skills.length === 0) {
              output +=
                "No code written yet. Use `foundry_implement` to get started.\n";
            }

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_docs ──────────────────────────────────────────────────────
        {
          name: "foundry_docs",
          label: "Read OpenClaw Docs",
          description:
            "Read OpenClaw plugin/hooks documentation for writing extensions",
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

            let output = `## OpenClaw Extension Docs\n\n`;

            if (!docs.plugin && !docs.hooks) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Could not load OpenClaw docs. Check openclawPath config.",
                  },
                ],
              };
            }

            if (section === "plugin" || section === "both") {
              output += `### Plugin API\n\n`;
              output += docs.plugin
                ? docs.plugin.slice(0, 8000) + "\n\n[truncated]\n\n"
                : "Not loaded\n\n";
            }

            if (section === "hooks" || section === "both") {
              output += `### Hooks API\n\n`;
              output += docs.hooks
                ? docs.hooks.slice(0, 5000) + "\n\n[truncated]\n\n"
                : "Not loaded\n\n";
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
                description:
                  "What to do: add_tool (add a new tool), add_code (inject code), read_self (view current source)",
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
              const altPath =
                "/Users/lekt9/Projects/aiko/extensions/foundry/index.ts";
              if (!existsSync(altPath)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Cannot find self at ${selfPath} or ${altPath}`,
                    },
                  ],
                };
              }
            }

            const actualPath = existsSync(selfPath)
              ? selfPath
              : "/Users/lekt9/Projects/aiko/extensions/foundry/index.ts";

            if (p.action === "read_self") {
              const content = readFileSync(actualPath, "utf-8");
              return {
                content: [
                  {
                    type: "text",
                    text: `## Self Source (${actualPath})\n\n\`\`\`typescript\n${content.slice(0, 10000)}\n\`\`\`\n\n[${content.length} chars total]`,
                  },
                ],
              };
            }

            if (p.action === "add_tool") {
              if (!p.toolName || !p.toolDescription || !p.toolCode) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Missing required: toolName, toolDescription, toolCode",
                    },
                  ],
                };
              }

              let content = readFileSync(actualPath, "utf-8");

              // Build the new tool
              const newTool = `
      // ── ${p.toolName} (self-written) ─────────────────────────────────────
      {
        name: "${p.toolName}",
        label: "${p.toolLabel || p.toolName}",
        description: "${p.toolDescription.replace(/"/g, '\\"')}",
        parameters: ${JSON.stringify(
          p.toolParameters || { type: "object", properties: {}, required: [] },
          null,
          10,
        )
          .replace(/^/gm, "        ")
          .trim()},
        async execute(_toolCallId: string, params: unknown) {
          const p = params as any;
${p.toolCode
  .split("\n")
  .map((l: string) => "          " + l)
  .join("\n")}
        },
      },`;

              // Find the end of the tools array (before the closing ];)
              const toolsArrayEnd = content.lastIndexOf(
                "    ];\n\n    const toolNames = [",
              );
              if (toolsArrayEnd === -1) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Could not find tools array end marker",
                    },
                  ],
                };
              }

              // Insert the new tool before the ];
              content =
                content.slice(0, toolsArrayEnd) +
                newTool +
                "\n" +
                content.slice(toolsArrayEnd);

              // Also add to toolNames
              const toolNamesMatch = content.match(
                /const toolNames = \[\n([\s\S]*?)\n    \];/,
              );
              if (toolNamesMatch) {
                const oldToolNames = toolNamesMatch[0];
                const newToolNames = oldToolNames.replace(
                  /\n    \];/,
                  `\n      "${p.toolName}",\n    ];`,
                );
                content = content.replace(oldToolNames, newToolNames);
              }

              writeFileSync(actualPath, content);

              return {
                content: [
                  {
                    type: "text",
                    text:
                      `## Self-Modified\n\n` +
                      `Added tool **${p.toolName}** to foundry extension.\n\n` +
                      `- Location: ${actualPath}\n` +
                      `- Lines added: ~${newTool.split("\n").length}\n\n` +
                      `**Call \`foundry_restart\` to load and resume.**`,
                  },
                ],
              };
            }

            if (p.action === "add_code") {
              if (!p.toolCode || !p.insertAfter) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "Missing required: toolCode, insertAfter",
                    },
                  ],
                };
              }

              let content = readFileSync(actualPath, "utf-8");
              const insertPos = content.indexOf(p.insertAfter);

              if (insertPos === -1) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Could not find marker: "${p.insertAfter.slice(0, 50)}..."`,
                    },
                  ],
                };
              }

              content =
                content.slice(0, insertPos + p.insertAfter.length) +
                "\n" +
                p.toolCode +
                content.slice(insertPos + p.insertAfter.length);
              writeFileSync(actualPath, content);

              return {
                content: [
                  {
                    type: "text",
                    text:
                      `## Self-Modified\n\n` +
                      `Inserted code after marker.\n\n` +
                      `**Call \`foundry_restart\` to load and resume.**`,
                  },
                ],
              };
            }

            return {
              content: [{ type: "text", text: `Unknown action: ${p.action}` }],
            };
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
                description:
                  "Why we're restarting (e.g., 'load new oauth-refresh extension')",
              },
              resumeContext: {
                type: "string" as const,
                description:
                  "Context to resume with after restart (what we were doing)",
              },
              lastMessage: {
                type: "string" as const,
                description:
                  "The user's last message/request to continue after restart",
              },
            },
            required: ["reason", "resumeContext"],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              reason: string;
              resumeContext: string;
              lastMessage?: string;
            };
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
              exec("openclaw gateway restart", (error: any) => {
                if (error) {
                  logger.error?.(`[foundry] Restart failed: ${error.message}`);
                }
              });
            }, 500);

            return {
              content: [
                {
                  type: "text",
                  text:
                    `## Gateway Restart Scheduled\n\n` +
                    `**Reason**: ${p.reason}\n\n` +
                    `Session context saved. The conversation will automatically resume after restart.\n\n` +
                    `Restarting in 500ms...`,
                },
              ],
            };
          },
        },

        // ── foundry_learnings ──────────────────────────────────────────────────
        {
          name: "foundry_learnings",
          label: "View Learnings",
          description:
            "View what foundry has learned from successes, failures, and patterns",
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
            if (filterType === "patterns")
              entries = learningEngine.getPatterns();
            else if (filterType === "failures")
              entries = learningEngine.getRecentFailures(10);
            else if (filterType === "insights")
              entries = learningEngine.getInsights();
            else entries = learningEngine.findRelevantLearnings(p.tool);

            let output = `## Foundry: Learnings\n\n`;
            output += `**Summary**: ${learningEngine.getLearningsSummary()}\n\n`;

            if (entries.length === 0) {
              output += "No learnings found for this filter.\n";
            } else {
              for (const entry of entries) {
                output += `### ${entry.type.toUpperCase()}: ${entry.tool || "general"}\n`;
                output += `- **ID**: \`${entry.id}\`\n`;
                if (entry.error)
                  output += `- **Error**: ${entry.error.slice(0, 100)}...\n`;
                if (entry.resolution)
                  output += `- **Resolution**: ${entry.resolution}\n`;
                if (entry.context)
                  output += `- **Context**: ${entry.context.slice(0, 200)}...\n`;
                if (entry.crystallizedTo)
                  output += `- **Crystallized**: ✅ ${entry.crystallizedTo}\n`;
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
                description:
                  "ID of an existing pattern to publish (for type=pattern)",
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
            const configPath = join(homedir(), ".openclaw", "openclaw.json");
            let creatorWallet: string | null = null;
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              creatorWallet =
                config?.plugins?.entries?.unbrowse?.config?.creatorWallet;
            } catch {}

            if (!creatorWallet) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No creator wallet configured. Use unbrowse_wallet to set up a wallet first.",
                  },
                ],
              };
            }

            // Get skill index URL from config
            let skillIndexUrl = "https://api.claw.getfoundry.app";
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              skillIndexUrl =
                config?.plugins?.entries?.unbrowse?.config?.skillIndexUrl ??
                skillIndexUrl;
            } catch {}

            let content = p.content;

            // For patterns, look up from learnings
            if (p.type === "pattern" && p.patternId) {
              const patterns = learningEngine.getPatterns();
              const pattern = patterns.find((pat) => pat.id === p.patternId);
              if (!pattern) {
                return {
                  content: [
                    { type: "text", text: `Pattern not found: ${p.patternId}` },
                  ],
                };
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
              return {
                content: [
                  {
                    type: "text",
                    text: "Provide content or patternId for the ability.",
                  },
                ],
              };
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
                return {
                  content: [{ type: "text", text: `Publish failed: ${text}` }],
                };
              }

              const result = (await resp.json()) as {
                id: string;
                slug: string;
                version: number;
                reviewStatus: string;
              };

              return {
                content: [
                  {
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
                  },
                ],
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Publish error: ${(err as Error).message}`,
                  },
                ],
              };
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
                enum: [
                  "skill",
                  "pattern",
                  "extension",
                  "technique",
                  "insight",
                  "agent",
                ],
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
            const p = params as {
              action: string;
              query?: string;
              type?: string;
              id?: string;
              limit?: number;
            };

            // Get config for marketplace
            const configPath = join(homedir(), ".openclaw", "openclaw.json");
            let skillIndexUrl = "https://api.claw.getfoundry.app";
            let solanaPrivateKey: string | undefined;
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              skillIndexUrl =
                config?.plugins?.entries?.unbrowse?.config?.skillIndexUrl ??
                skillIndexUrl;
              const walletPath =
                config?.plugins?.entries?.unbrowse?.config?.solanaWalletPath;
              if (walletPath && existsSync(walletPath)) {
                const walletData = JSON.parse(
                  readFileSync(walletPath, "utf-8"),
                );
                solanaPrivateKey = walletData.privateKey;
              }
            } catch {}

            // Lazy-load brain client
            const { BrainIndexClient } = await import("./src/brain-index.js");
            const brainClient = new BrainIndexClient({
              indexUrl: skillIndexUrl,
              solanaPrivateKey,
            });

            try {
              if (p.action === "leaderboard") {
                const result = await brainClient.getLeaderboard({
                  type: p.type as any,
                  limit: p.limit ?? 20,
                });

                if (result.abilities.length === 0) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: "No abilities in leaderboard yet. Be the first to publish!",
                      },
                    ],
                  };
                }

                const lines = [
                  `## Foundry Marketplace Leaderboard`,
                  ``,
                  `Showing top ${result.abilities.length} abilities by rank score:`,
                  ``,
                ];

                for (const ability of result.abilities) {
                  const price =
                    ability.priceCents === 0
                      ? "FREE"
                      : `$${(ability.priceCents / 100).toFixed(2)}`;
                  lines.push(
                    `**${ability.service}** (${ability.abilityType})`,
                    `  ID: ${ability.id} | Payers: ${ability.uniquePayers} | Score: ${ability.rankScore} | ${price}`,
                    ``,
                  );
                }

                lines.push(
                  `Use foundry_marketplace with action="install" and id="<id>" to download.`,
                );
                return { content: [{ type: "text", text: lines.join("\n") }] };
              }

              if (p.action === "search") {
                if (!p.query) {
                  return {
                    content: [
                      { type: "text", text: "Provide a query for search." },
                    ],
                  };
                }

                const result = await brainClient.searchAbilities(p.query, {
                  type: p.type as any,
                  limit: p.limit ?? 10,
                });

                if (result.skills.length === 0) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `No abilities found for: ${p.query}`,
                      },
                    ],
                  };
                }

                const lines = [
                  `## Search Results: "${p.query}"`,
                  ``,
                  `Found ${result.total} abilities:`,
                  ``,
                ];

                for (const ability of result.skills) {
                  const price =
                    ability.priceCents === 0
                      ? "FREE"
                      : `$${(ability.priceCents / 100).toFixed(2)}`;
                  lines.push(
                    `**${ability.service}** (${ability.abilityType})`,
                    `  ID: ${ability.id} | Downloads: ${ability.downloadCount} | ${price}`,
                    ``,
                  );
                }

                lines.push(
                  `Use foundry_marketplace with action="install" and id="<id>" to download.`,
                );
                return { content: [{ type: "text", text: lines.join("\n") }] };
              }

              if (p.action === "install") {
                if (!p.id) {
                  return {
                    content: [
                      { type: "text", text: "Provide an id to install." },
                    ],
                  };
                }

                const ability = await brainClient.downloadAbility(p.id);

                // Handle different ability types
                const abilityType =
                  (ability as any).abilityType ||
                  (ability as any).type ||
                  "skill";

                if (abilityType === "pattern") {
                  // Record pattern in learning engine
                  const content = (ability as any).content;
                  if (content?.errorPattern && content?.resolution) {
                    const patternId = learningEngine.recordFailure(
                      "imported",
                      content.errorPattern,
                      content.context,
                    );
                    learningEngine.recordResolution(
                      patternId,
                      content.resolution,
                    );
                    return {
                      content: [
                        {
                          type: "text",
                          text: [
                            `Installed pattern: ${(ability as any).service}`,
                            ``,
                            `Error: ${content.errorPattern}`,
                            `Resolution: ${content.resolution}`,
                            ``,
                            `Pattern recorded — will be suggested when similar errors occur.`,
                          ].join("\n"),
                        },
                      ],
                    };
                  }
                }

                if (abilityType === "extension") {
                  // Write extension to extensions directory
                  const content = (ability as any).content;
                  if (content?.code) {
                    const extId =
                      (ability as any).service
                        ?.toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-") || "imported-ext";
                    const result = await writer.writeExtension({
                      id: extId,
                      name: (ability as any).service,
                      description: content.description || "",
                      tools: [],
                      hooks: [],
                    });

                    return {
                      content: [
                        {
                          type: "text",
                          text: [
                            `Installed extension: ${(ability as any).service}`,
                            ``,
                            `Path: ${result.path}`,
                            ``,
                            `Run foundry_restart to load the new extension.`,
                          ].join("\n"),
                        },
                      ],
                    };
                  }
                }

                // Default: return raw ability info
                return {
                  content: [
                    {
                      type: "text",
                      text: [
                        `Downloaded: ${(ability as any).service || p.id}`,
                        `Type: ${abilityType}`,
                        ``,
                        `Content:`,
                        JSON.stringify(
                          (ability as any).content || ability,
                          null,
                          2,
                        ).slice(0, 2000),
                      ].join("\n"),
                    },
                  ],
                };
              }

              return {
                content: [
                  {
                    type: "text",
                    text: `Unknown action: ${p.action}. Use search, leaderboard, or install.`,
                  },
                ],
              };
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Marketplace error: ${(err as Error).message}`,
                  },
                ],
              };
            }
          },
        },

        // ── foundry_overseer ────────────────────────────────────────────────────
        // Self-Improving Coding Agent (arXiv:2504.15228): Autonomous overseer
        {
          name: "foundry_overseer",
          label: "Run Overseer",
          description:
            "Run the autonomous overseer to analyze patterns, identify crystallization candidates, " +
            "find recurring failures, and get self-improvement recommendations.",
          parameters: {
            type: "object" as const,
            properties: {},
            required: [] as string[],
          },
          async execute() {
            const report = learningEngine.runOverseer(dataDir);
            const metrics = learningEngine.getAllToolMetrics();

            let output = `## Foundry Overseer Report\n\n`;
            output += `**Generated**: ${report.timestamp}\n`;
            output += `**Patterns analyzed**: ${report.patternsAnalyzed}\n\n`;

            // Tool fitness (ADAS)
            if (metrics.length > 0) {
              output += `### Tool Fitness (ADAS)\n`;
              const sorted = metrics.sort((a, b) => b.fitness - a.fitness);
              for (const m of sorted.slice(0, 10)) {
                const bar =
                  "█".repeat(Math.floor(m.fitness * 10)) +
                  "░".repeat(10 - Math.floor(m.fitness * 10));
                output += `- **${m.toolName}**: ${bar} ${(m.fitness * 100).toFixed(0)}% (${m.successCount}/${m.successCount + m.failureCount})\n`;
              }
              output += `\n`;
            }

            // Crystallization candidates (HexMachina)
            const allCandidates = learningEngine.getCrystallizationCandidates();
            if (allCandidates.length > 0) {
              output += `### Crystallization Candidates (HexMachina)\n`;
              output += `Patterns with resolutions ready to become executable hooks:\n\n`;
              for (const c of allCandidates) {
                output += `- **${c.tool}**: "${c.error?.slice(0, 50)}..." (used ${c.useCount}x)\n`;
                output += `  → \`foundry_crystallize patternId="${c.id}"\`\n`;
              }
              output += `\n`;
            }

            // Recurring failures
            if (report.recurringFailures.length > 0) {
              output += `### Recurring Failures (Need Attention)\n`;
              for (const f of report.recurringFailures) {
                output += `- **${f.signature}**: ${f.count} occurrences\n`;
              }
              output += `\n`;
            }

            // Actions taken (autonomous behavior)
            if (report.actionsExecuted.length > 0) {
              output += `### Actions Executed\n`;
              for (const action of report.actionsExecuted) {
                output += `- ${action}\n`;
              }
              output += `\n`;
            }

            if (
              report.crystallizationCandidates.length === 0 &&
              report.recurringFailures.length === 0 &&
              report.actionsExecuted.length === 0
            ) {
              output += `No immediate actions needed.\n`;
            }

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_crystallize ─────────────────────────────────────────────────
        // HexMachina (arXiv:2506.04651): LLM-driven crystallization
        // Returns pattern context and asks LLM to generate hook code
        {
          name: "foundry_crystallize",
          label: "Crystallize Pattern",
          description:
            "Start crystallization of a learned pattern. Returns pattern details and instructions " +
            "for generating hook code. After reviewing, call foundry_save_hook with the generated code.",
          parameters: {
            type: "object" as const,
            properties: {
              patternId: {
                type: "string" as const,
                description:
                  "ID of the pattern to crystallize (from foundry_overseer)",
              },
            },
            required: ["patternId"] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as { patternId: string };
            const pattern = learningEngine
              .getPatterns()
              .find((l) => l.id === p.patternId);

            if (!pattern) {
              return {
                content: [
                  { type: "text", text: `Pattern not found: ${p.patternId}` },
                ],
              };
            }
            if (!pattern.resolution) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Pattern has no resolution to crystallize`,
                  },
                ],
              };
            }
            if (pattern.crystallizedTo) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Already crystallized to: ${pattern.crystallizedTo}`,
                  },
                ],
              };
            }

            // HexMachina: Return context for LLM to generate the hook
            let output = `## Crystallize Pattern: ${pattern.id}\n\n`;
            output += `### Pattern Details\n`;
            output += `- **Tool**: \`${pattern.tool}\`\n`;
            output += `- **Error Pattern**: ${pattern.error}\n`;
            output += `- **Learned Resolution**: ${pattern.resolution}\n`;
            output += `- **Context**: ${pattern.context || "N/A"}\n`;
            output += `- **Use Count**: ${pattern.useCount}\n`;
            output += `- **Success Trajectory**: ${(pattern.improvementTrajectory || []).join(", ") || "N/A"}\n\n`;

            output += `### Generate Hook Code\n\n`;
            output += `Create a \`before_tool_call\` hook that:\n`;
            output += `1. Triggers when \`${pattern.tool}\` is about to be called\n`;
            output += `2. Detects conditions that would lead to: "${pattern.error?.slice(0, 100)}"\n`;
            output += `3. Applies the resolution proactively: "${pattern.resolution}"\n`;
            output += `4. Uses \`ctx.injectSystemMessage()\` to guide the LLM\n\n`;

            output += `### Hook Template\n`;
            output += `\`\`\`typescript\n`;
            output += `api.on("before_tool_call", async (event, ctx) => {\n`;
            output += `  if (event.toolName === "${pattern.tool}") {\n`;
            output += `    // TODO: Add detection logic for the error condition\n`;
            output += `    // TODO: Apply resolution proactively\n`;
            output += `    if (ctx?.injectSystemMessage) {\n`;
            output += `      ctx.injectSystemMessage(\`[CRYSTALLIZED] Apply: ${pattern.resolution?.slice(0, 100)}\`);\n`;
            output += `    }\n`;
            output += `  }\n`;
            output += `});\n`;
            output += `\`\`\`\n\n`;

            output += `### Next Step\n`;
            output += `Generate the complete hook code based on the pattern above, then call:\n`;
            output += `\`\`\`\n`;
            output += `foundry_save_hook(\n`;
            output += `  patternId: "${pattern.id}",\n`;
            output += `  hookCode: "<your generated code>"\n`;
            output += `)\n`;
            output += `\`\`\`\n`;

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_save_hook ──────────────────────────────────────────────────
        // HexMachina: Save LLM-generated hook code
        {
          name: "foundry_save_hook",
          label: "Save Crystallized Hook",
          description:
            "Save the LLM-generated hook code from crystallization. " +
            "Call this after foundry_crystallize with the generated code.",
          parameters: {
            type: "object" as const,
            properties: {
              patternId: {
                type: "string" as const,
                description: "ID of the pattern being crystallized",
              },
              hookCode: {
                type: "string" as const,
                description: "The generated hook code (TypeScript)",
              },
              hookName: {
                type: "string" as const,
                description:
                  "Optional name for the hook (defaults to pattern-based name)",
              },
            },
            required: ["patternId", "hookCode"] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              patternId: string;
              hookCode: string;
              hookName?: string;
            };
            const pattern = learningEngine
              .getPatterns()
              .find((l) => l.id === p.patternId);

            if (!pattern) {
              return {
                content: [
                  { type: "text", text: `Pattern not found: ${p.patternId}` },
                ],
              };
            }
            if (pattern.crystallizedTo) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Already crystallized to: ${pattern.crystallizedTo}`,
                  },
                ],
              };
            }

            // Validate the hook code has basic structure
            if (
              !p.hookCode.includes("api.on") &&
              !p.hookCode.includes("event") &&
              !p.hookCode.includes("ctx")
            ) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Invalid hook code - must include api.on(), event, and ctx`,
                  },
                ],
              };
            }

            // Generate hook ID and save
            const hookId =
              p.hookName || `crystallized_${pattern.tool}_${Date.now()}`;
            const hooksDir = join(dataDir, "hooks");
            if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

            const hookPath = join(hooksDir, `${hookId}.ts`);
            const fullCode = `// HexMachina crystallized from pattern: ${pattern.id}
// Tool: ${pattern.tool}
// Error: ${pattern.error?.slice(0, 100)}
// Resolution: ${pattern.resolution?.slice(0, 100)}
// Generated by LLM

${p.hookCode}
`;
            writeFileSync(hookPath, fullCode);
            learningEngine.markCrystallized(p.patternId, hookId);

            let output = `## Hook Saved\n\n`;
            output += `**Pattern**: ${pattern.id}\n`;
            output += `**Hook ID**: ${hookId}\n`;
            output += `**Path**: ${hookPath}\n\n`;
            output += `The pattern is now executable code.\n`;
            output += `Run \`foundry_restart\` to activate the hook.\n`;

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_metrics ─────────────────────────────────────────────────────
        // ADAS (arXiv:2408.08435): View tool performance metrics
        {
          name: "foundry_metrics",
          label: "Tool Metrics",
          description:
            "View tool performance metrics and fitness scores for agent evolution.",
          parameters: {
            type: "object" as const,
            properties: {
              toolName: {
                type: "string" as const,
                description: "Specific tool to get metrics for (optional)",
              },
            },
            required: [] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as { toolName?: string };
            const metrics = learningEngine.getAllToolMetrics();

            if (p.toolName) {
              const m = metrics.find((m) => m.toolName === p.toolName);
              if (!m)
                return {
                  content: [
                    { type: "text", text: `No metrics for: ${p.toolName}` },
                  ],
                };

              return {
                content: [
                  {
                    type: "text",
                    text: `
## ${m.toolName} Metrics

- **Fitness**: ${(m.fitness * 100).toFixed(1)}%
- **Success**: ${m.successCount}
- **Failure**: ${m.failureCount}
- **Avg Latency**: ${m.successCount + m.failureCount > 0 ? (m.totalLatencyMs / (m.successCount + m.failureCount)).toFixed(0) : 0}ms
`,
                  },
                ],
              };
            }

            if (metrics.length === 0) {
              return {
                content: [
                  { type: "text", text: "No tool metrics recorded yet." },
                ],
              };
            }

            const sorted = metrics.sort((a, b) => b.fitness - a.fitness);
            let output = `## Tool Performance Metrics (ADAS)\n\n`;
            output += `| Tool | Fitness | Success | Failure | Avg Latency |\n`;
            output += `|------|---------|---------|---------|-------------|\n`;

            for (const m of sorted) {
              const avgLatency =
                m.successCount + m.failureCount > 0
                  ? (
                      m.totalLatencyMs /
                      (m.successCount + m.failureCount)
                    ).toFixed(0)
                  : 0;
              output += `| ${m.toolName} | ${(m.fitness * 100).toFixed(0)}% | ${m.successCount} | ${m.failureCount} | ${avgLatency}ms |\n`;
            }

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_evolve ─────────────────────────────────────────────────────
        // ADAS (arXiv:2408.08435): Evolve underperforming tools
        {
          name: "foundry_evolve",
          label: "Evolve Tools",
          description:
            "Identify underperforming tools and generate improved versions using ADAS patterns. " +
            "Returns analysis and improvement prompts for the LLM to generate better implementations.",
          parameters: {
            type: "object" as const,
            properties: {
              fitnessThreshold: {
                type: "number" as const,
                description:
                  "Tools below this fitness (0-1) will be flagged for evolution. Default: 0.5",
              },
              toolName: {
                type: "string" as const,
                description: "Specific tool to evolve (optional)",
              },
            },
            required: [] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              fitnessThreshold?: number;
              toolName?: string;
            };
            const threshold = p.fitnessThreshold ?? 0.5;
            const metrics = learningEngine.getAllToolMetrics();

            // Find underperforming tools
            let underperforming = metrics.filter(
              (m) =>
                m.fitness < threshold && m.successCount + m.failureCount >= 3, // Minimum samples
            );

            if (p.toolName) {
              underperforming = underperforming.filter(
                (m) => m.toolName === p.toolName,
              );
            }

            if (underperforming.length === 0) {
              if (p.toolName) {
                const m = metrics.find((m) => m.toolName === p.toolName);
                if (m) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `Tool "${p.toolName}" has fitness ${(m.fitness * 100).toFixed(0)}% (above threshold ${(threshold * 100).toFixed(0)}%)`,
                      },
                    ],
                  };
                }
                return {
                  content: [
                    { type: "text", text: `No metrics for: ${p.toolName}` },
                  ],
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: `No underperforming tools found (threshold: ${(threshold * 100).toFixed(0)}%)`,
                  },
                ],
              };
            }

            // Get failure patterns for these tools
            const patterns = learningEngine.getPatterns();
            const failures = learningEngine
              .getAll()
              .filter((l) => l.type === "failure");

            let output = `## ADAS Tool Evolution\n\n`;
            output += `Found ${underperforming.length} tool(s) below ${(threshold * 100).toFixed(0)}% fitness.\n\n`;

            for (const tool of underperforming) {
              output += `### ${tool.toolName}\n\n`;
              output += `**Current Performance:**\n`;
              output += `- Fitness: ${(tool.fitness * 100).toFixed(0)}%\n`;
              output += `- Success: ${tool.successCount} | Failure: ${tool.failureCount}\n`;
              output += `- Avg Latency: ${tool.successCount + tool.failureCount > 0 ? (tool.totalLatencyMs / (tool.successCount + tool.failureCount)).toFixed(0) : 0}ms\n\n`;

              // Find related failures
              const toolFailures = failures
                .filter((f) => f.tool === tool.toolName)
                .slice(-5);
              if (toolFailures.length > 0) {
                output += `**Recent Failures:**\n`;
                for (const f of toolFailures) {
                  output += `- ${f.error?.slice(0, 80)}...\n`;
                }
                output += `\n`;
              }

              // Find related patterns (resolutions)
              const toolPatterns = patterns.filter(
                (p) => p.tool === tool.toolName,
              );
              if (toolPatterns.length > 0) {
                output += `**Known Solutions:**\n`;
                for (const p of toolPatterns) {
                  output += `- Error: ${p.error?.slice(0, 50)}... → Resolution: ${p.resolution?.slice(0, 80)}\n`;
                }
                output += `\n`;
              }

              output += `**Evolution Strategy:**\n`;
              output += `Based on the failure patterns, consider:\n`;
              output += `1. Adding pre-validation of inputs\n`;
              output += `2. Adding retry logic with backoff\n`;
              output += `3. Adding fallback behavior\n`;
              output += `4. Improving error messages\n\n`;
            }

            output += `### Next Steps\n\n`;
            output += `To evolve a tool, analyze the failures above and:\n`;
            output += `1. Design an improved implementation\n`;
            output += `2. Use \`foundry_add_tool\` to add a new version, or\n`;
            output += `3. Use \`foundry_extend_self\` to add a wrapper/improvement\n\n`;
            output += `The new version should address the failure patterns while maintaining the original functionality.\n`;

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_track_outcome ──────────────────────────────────────────────
        // Outcome-based learning: register a task for feedback tracking
        {
          name: "foundry_track_outcome",
          label: "Track Outcome",
          description:
            "Register a task (e.g., TikTok post, tweet, email campaign) for outcome tracking. " +
            "Later, collect real-world feedback (views, engagement) to learn what works.",
          parameters: {
            type: "object" as const,
            properties: {
              taskType: {
                type: "string" as const,
                description:
                  "Type of task (e.g., 'tiktok_post', 'tweet', 'linkedin_post', 'email_campaign')",
              },
              taskDescription: {
                type: "string" as const,
                description: "Brief description of what was done",
              },
              taskParams: {
                type: "object" as const,
                description:
                  "Parameters used (content, hashtags, timing, audience, etc.)",
              },
              successThreshold: {
                type: "object" as const,
                description:
                  "Optional: metrics thresholds for success (e.g., { views: 1000, likes: 50 })",
              },
            },
            required: ["taskType", "taskDescription", "taskParams"] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              taskType: string;
              taskDescription: string;
              taskParams: Record<string, any>;
              successThreshold?: Record<string, number>;
            };

            const outcomeId = learningEngine.trackOutcome(
              p.taskType,
              p.taskDescription,
              p.taskParams,
              p.successThreshold,
            );

            return {
              content: [
                {
                  type: "text",
                  text:
                    `Tracking outcome: **${p.taskType}**\n\n` +
                    `**ID**: \`${outcomeId}\`\n` +
                    `**Description**: ${p.taskDescription}\n` +
                    `**Params**: ${JSON.stringify(p.taskParams, null, 2)}\n\n` +
                    `Use \`foundry_record_feedback\` with this ID once you have engagement metrics, ` +
                    `or the system will automatically attempt to collect feedback after 1 hour.`,
                },
              ],
            };
          },
        },

        // ── foundry_record_feedback ────────────────────────────────────────────
        // Manually record feedback metrics for a tracked outcome
        {
          name: "foundry_record_feedback",
          label: "Record Feedback",
          description:
            "Record real-world feedback metrics for a tracked outcome. " +
            "This updates the outcome with engagement data and triggers insight regeneration.",
          parameters: {
            type: "object" as const,
            properties: {
              outcomeId: {
                type: "string" as const,
                description: "The outcome ID returned by foundry_track_outcome",
              },
              metrics: {
                type: "object" as const,
                description:
                  "Engagement metrics (e.g., { views: 5000, likes: 120, comments: 15, shares: 8 })",
              },
              feedbackSource: {
                type: "string" as const,
                description:
                  "Source of the metrics (e.g., 'tiktok_analytics', 'twitter_api', 'manual')",
              },
            },
            required: ["outcomeId", "metrics", "feedbackSource"] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as {
              outcomeId: string;
              metrics: Record<string, number>;
              feedbackSource: string;
            };

            const outcome = learningEngine.recordFeedback(
              p.outcomeId,
              p.metrics,
              p.feedbackSource,
            );

            if (!outcome) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Outcome not found: \`${p.outcomeId}\``,
                  },
                ],
              };
            }

            const insights = learningEngine.getTaskInsights(outcome.taskType);

            return {
              content: [
                {
                  type: "text",
                  text:
                    `Feedback recorded for **${outcome.taskType}**\n\n` +
                    `**Metrics**: ${JSON.stringify(outcome.metrics)}\n` +
                    `**Success**: ${outcome.success === true ? "✅ Yes" : outcome.success === false ? "❌ No" : "⏳ Pending"}\n\n` +
                    (insights
                      ? `**Updated Insights** (${insights.totalTasks} tasks tracked):\n` +
                        insights.recommendations.map((r) => `- ${r}`).join("\n")
                      : ""),
                },
              ],
            };
          },
        },

        // ── foundry_get_insights ───────────────────────────────────────────────
        // Get learned insights for a task type
        {
          name: "foundry_get_insights",
          label: "Get Outcome Insights",
          description:
            "Get learned insights and recommendations for a task type based on past outcomes. " +
            "Use this before executing a task to apply what worked before.",
          parameters: {
            type: "object" as const,
            properties: {
              taskType: {
                type: "string" as const,
                description:
                  "Type of task (e.g., 'tiktok_post', 'tweet'). Leave empty to list all task types.",
              },
            },
            required: [] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as { taskType?: string };

            if (!p.taskType) {
              // List all task types with insights
              const taskTypes = learningEngine.getAllTaskTypes();
              if (taskTypes.length === 0) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "No outcome insights yet. Use `foundry_track_outcome` to start tracking tasks.",
                    },
                  ],
                };
              }

              let output = `## Task Types with Insights\n\n`;
              for (const type of taskTypes) {
                const insights = learningEngine.getTaskInsights(type);
                if (insights) {
                  output += `- **${type}**: ${insights.totalTasks} tasks (${insights.successfulTasks} successful)\n`;
                }
              }
              output += `\nUse \`foundry_get_insights\` with a specific taskType for detailed recommendations.`;
              return { content: [{ type: "text", text: output }] };
            }

            const insights = learningEngine.getTaskInsights(p.taskType);
            if (!insights || insights.totalTasks === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No insights for **${p.taskType}** yet. Track some outcomes first.`,
                  },
                ],
              };
            }

            let output = `## Insights: ${p.taskType}\n\n`;
            output += `**Total Tasks**: ${insights.totalTasks} (${insights.successfulTasks} successful)\n\n`;

            if (Object.keys(insights.avgMetrics).length > 0) {
              output += `**Average Metrics**:\n`;
              for (const [key, value] of Object.entries(insights.avgMetrics)) {
                output += `- ${key}: ${value}\n`;
              }
              output += `\n`;
            }

            if (insights.recommendations.length > 0) {
              output += `**Recommendations**:\n`;
              for (const rec of insights.recommendations) {
                output += `- ${rec}\n`;
              }
              output += `\n`;
            }

            if (insights.patterns.successful.length > 0) {
              output += `**Successful Patterns**:\n`;
              for (const pat of insights.patterns.successful) {
                output += `- ${pat}\n`;
              }
              output += `\n`;
            }

            if (insights.patterns.unsuccessful.length > 0) {
              output += `**Patterns to Avoid**:\n`;
              for (const pat of insights.patterns.unsuccessful) {
                output += `- ${pat}\n`;
              }
              output += `\n`;
            }

            if (insights.topPerformers.length > 0) {
              output += `**Top Performers**:\n`;
              for (const top of insights.topPerformers) {
                output += `- ${top.taskDescription.slice(0, 50)}... (${JSON.stringify(top.metrics)})\n`;
              }
            }

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_pending_feedback ───────────────────────────────────────────
        // List outcomes pending feedback collection
        {
          name: "foundry_pending_feedback",
          label: "Pending Feedback",
          description:
            "List outcomes that are awaiting feedback collection. " +
            "These are tasks that were tracked but haven't had metrics recorded yet.",
          parameters: {
            type: "object" as const,
            properties: {
              taskType: {
                type: "string" as const,
                description: "Filter by task type (optional)",
              },
            },
            required: [] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as { taskType?: string };
            const pending = learningEngine.getPendingFeedback(p.taskType);

            if (pending.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No outcomes pending feedback collection.",
                  },
                ],
              };
            }

            let output = `## Pending Feedback Collection\n\n`;
            output += `${pending.length} outcomes awaiting metrics:\n\n`;

            for (const outcome of pending.slice(0, 10)) {
              const age = Math.round(
                (Date.now() - new Date(outcome.executedAt).getTime()) /
                  (60 * 60 * 1000),
              );
              output += `- **${outcome.taskType}** (\`${outcome.id}\`)\n`;
              output += `  - ${outcome.taskDescription.slice(0, 60)}...\n`;
              output += `  - Executed: ${age}h ago\n`;
            }

            if (pending.length > 10) {
              output += `\n...and ${pending.length - 10} more.`;
            }

            output += `\n\nUse \`foundry_record_feedback\` to record metrics for these outcomes.`;

            return { content: [{ type: "text", text: output }] };
          },
        },

        // ── foundry_apply_improvement ──────────────────────────────────────────
        // Apply learned improvements to skills/extensions
        {
          name: "foundry_apply_improvement",
          label: "Apply Improvement",
          description:
            "Apply a learned improvement suggestion to a skill or extension. " +
            "This generates the necessary code changes based on outcome-based learnings.",
          parameters: {
            type: "object" as const,
            properties: {
              taskType: {
                type: "string" as const,
                description: "The task type with the improvement suggestion",
              },
              confirm: {
                type: "boolean" as const,
                description:
                  "Set to true to apply the changes (default: preview only)",
              },
            },
            required: ["taskType"] as string[],
          },
          async execute(_toolCallId: string, params: unknown) {
            const p = params as { taskType: string; confirm?: boolean };
            const insights = learningEngine.getTaskInsights(p.taskType);

            if (!insights?.improvementSuggestion) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      `No improvement suggestion available for **${p.taskType}**.\n\n` +
                        `Available suggestions:\n` +
                        learningEngine
                          .getImprovementSuggestions()
                          .map(
                            (s) =>
                              `- **${s.taskType}**: ${s.suggestion.suggestedChanges[0]}...`,
                          )
                          .join("\n") || "None",
                  },
                ],
              };
            }

            const suggestion = insights.improvementSuggestion;

            if (suggestion.appliedAt) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Improvement for **${p.taskType}** was already applied on ${suggestion.appliedAt}.`,
                  },
                ],
              };
            }

            let output = `## Improvement Suggestion for ${p.taskType}\n\n`;
            output += `**Confidence**: ${(suggestion.confidence * 100).toFixed(0)}%\n`;
            output += `**Based on**: ${insights.totalTasks} tracked outcomes (${insights.successfulTasks} successful)\n\n`;

            output += `**Suggested Changes**:\n`;
            for (const change of suggestion.suggestedChanges) {
              output += `- ${change}\n`;
            }
            output += `\n`;

            if (suggestion.targetSkill) {
              output += `**Target Skill**: ${suggestion.targetSkill}\n\n`;
            }

            if (p.confirm) {
              // Generate improvement prompt for the LLM to implement
              output += `---\n\n`;
              output += `## Implementation Prompt\n\n`;
              output += `Apply these improvements to the ${suggestion.targetSkill || p.taskType} skill/tool:\n\n`;

              for (const change of suggestion.suggestedChanges) {
                output += `1. ${change}\n`;
              }

              output += `\nBased on outcome data:\n`;
              output += `- Best performers had: ${insights.patterns.successful.slice(0, 2).join("; ")}\n`;
              if (insights.patterns.unsuccessful.length > 0) {
                output += `- Avoid: ${insights.patterns.unsuccessful[0]}\n`;
              }

              output += `\nUse \`foundry_extend_self\` or \`foundry_add_hook\` to implement these changes.\n`;
              output += `After implementation, use \`foundry_restart\` to apply.\n\n`;

              // Mark as applied (LLM is now responsible for implementing)
              learningEngine.markImprovementApplied(p.taskType);
              output += `✅ Improvement marked as applied.`;
            } else {
              output += `\nRun with \`confirm: true\` to generate the implementation prompt.`;
            }

            return { content: [{ type: "text", text: output }] };
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
      "foundry_overseer",
      "foundry_crystallize",
      "foundry_save_hook",
      "foundry_metrics",
      "foundry_evolve",
      // Outcome-based learning
      "foundry_track_outcome",
      "foundry_record_feedback",
      "foundry_get_insights",
      "foundry_pending_feedback",
      "foundry_apply_improvement",
    ];

    api.registerTool(tools, { names: toolNames });

    // ── before_agent_start Hook ─────────────────────────────────────────────
    // Check for pending session (resume after restart) and inject learnings
    // Start workflow tracking and inject proactive suggestions
    api.on("before_agent_start", async (event: any, ctx: any) => {
      const extensions = writer.getExtensions();
      const skills = writer.getSkills();
      const pendingSession = learningEngine.getPendingSession();
      const userMessage = event?.userMessage || ctx?.lastUserMessage || "";

      // Start tracking this workflow
      if (userMessage) {
        learningEngine.startWorkflow(userMessage);
      }

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

      // Workflow suggestions: check if user's message matches known patterns
      let workflowContext = "";
      if (userMessage && !pendingSession) {
        const suggestions = learningEngine.findMatchingWorkflows(userMessage);
        if (suggestions.length > 0) {
          workflowContext = `
## 🔄 WORKFLOW SUGGESTIONS

Based on your request, I've done similar workflows before:

${suggestions.map((s) => `- **${s.signature}** (${(s.confidence * 100).toFixed(0)}% match)\n  ${s.description}`).join("\n\n")}

I can follow one of these proven approaches, or we can try something new.

`;
          logger.info(
            `[foundry] Injected ${suggestions.length} workflow suggestions`,
          );
        }

        // First-run onboarding
        if (learningEngine.isFirstRun()) {
          workflowContext += `
## 👋 FOUNDRY LEARNING

This is our first session! I'll start learning your workflows:
- I observe which tools you use and in what order
- After 3+ repetitions of a pattern, I'll suggest automating it
- The more we work together, the better I get at anticipating your needs

`;
          logger.info(`[foundry] First run - injected onboarding message`);
        }
      }

      // Include relevant learnings if we have patterns
      const patterns = learningEngine.getPatterns().slice(-3);
      const insights = learningEngine.getInsights().slice(-2);
      let learningsContext = "";

      if (patterns.length > 0 || insights.length > 0) {
        learningsContext = `
## Learned Patterns

${patterns.map((p) => `- **${p.tool}**: ${p.error?.slice(0, 50)}... → ${p.resolution?.slice(0, 100)}`).join("\n")}
${insights.map((i) => `- **Insight**: ${i.context?.slice(0, 100)}`).join("\n")}

`;
      }

      // ADAS: Proactive evolution injection
      // Check if overseer found underperforming tools that need evolution
      const overseerReport = learningEngine.getLastOverseerReport();
      let evolutionContext = "";

      if (
        overseerReport?.evolutionCandidates &&
        overseerReport.evolutionCandidates.length > 0
      ) {
        const topCandidates = overseerReport.evolutionCandidates.slice(0, 3);
        evolutionContext = `
## ⚠️ PROACTIVE EVOLUTION NEEDED

The following tools are underperforming and may benefit from evolution:

${topCandidates
  .map((t) => {
    const totalCalls = t.successCount + t.failureCount;
    const avgLatency =
      totalCalls > 0 ? (t.totalLatencyMs / totalCalls).toFixed(0) : "N/A";
    return `- **${t.toolName}**: ${(t.fitness * 100).toFixed(0)}% fitness (${t.successCount}/${totalCalls} success, avg ${avgLatency}ms)`;
  })
  .join("\n")}

Consider using \`foundry_evolve\` to analyze and improve these tools, or investigate why they're failing.

`;
      }

      // Include recurring failures that need attention
      if (
        overseerReport?.recurringFailures &&
        overseerReport.recurringFailures.length > 0
      ) {
        const topFailures = overseerReport.recurringFailures.slice(0, 2);
        evolutionContext += `
## 🔁 Recurring Failures

${topFailures.map((f) => `- **${f.signature}**: ${f.count}x failures - needs resolution pattern`).join("\n")}

Consider using \`foundry_crystallize\` after resolving these to prevent future occurrences.

`;
      }

      // Outcome-based learning: inject insights for task types the agent has learned about
      let outcomeInsights = "";
      const taskTypes = learningEngine.getAllTaskTypes();
      if (taskTypes.length > 0) {
        outcomeInsights = `
## 📊 Outcome-Based Learnings

You have feedback data for: ${taskTypes.join(", ")}

`;
        // Include top 2 task type summaries
        for (const taskType of taskTypes.slice(0, 2)) {
          const typeInsights = learningEngine.getTaskInsights(taskType);
          if (typeInsights && typeInsights.recommendations.length > 0) {
            outcomeInsights += `**${taskType}** (${typeInsights.totalTasks} tracked, ${typeInsights.successfulTasks} successful):\n`;
            outcomeInsights +=
              typeInsights.recommendations
                .slice(0, 3)
                .map((r) => `- ${r}`)
                .join("\n") + "\n\n";
          }
        }

        outcomeInsights += `Use \`foundry_get_insights\` for detailed recommendations before executing similar tasks.
Use \`foundry_track_outcome\` after executing tasks to continue learning.

`;
      }

      // Check for pending feedback that should be collected
      const pendingFeedback = learningEngine.getPendingFeedback();
      if (pendingFeedback.length > 0) {
        outcomeInsights += `**⏳ ${pendingFeedback.length} outcomes awaiting feedback** - consider collecting metrics.\n\n`;
      }

      // Check for improvement suggestions that should be applied
      const improvementSuggestions = learningEngine.getImprovementSuggestions();
      if (improvementSuggestions.length > 0) {
        outcomeInsights += `## 🔧 SKILL IMPROVEMENTS READY\n\n`;
        outcomeInsights += `Based on outcome data, these skills should be upgraded:\n\n`;
        for (const { taskType, suggestion } of improvementSuggestions.slice(
          0,
          2,
        )) {
          outcomeInsights += `- **${taskType}** (${(suggestion.confidence * 100).toFixed(0)}% confidence):\n`;
          for (const change of suggestion.suggestedChanges.slice(0, 2)) {
            outcomeInsights += `  - ${change}\n`;
          }
        }
        outcomeInsights += `\nUse \`foundry_apply_improvement\` to implement these upgrades.\n\n`;
      }

      const workflowStats = learningEngine.getWorkflowStats();

      return {
        prependContext: `${resumeContext}${workflowContext}${evolutionContext}${outcomeInsights}${learningsContext}
## Foundry: Self-Writing Coding Subagent

Grounded in **docs.molt.bot** — fetches documentation on demand. Can modify its own source code.

**Written**: ${extensions.length} extensions, ${skills.length} skills | **Learnings**: ${learningEngine.getLearningsSummary()} | **Workflows**: ${workflowStats.totalWorkflows} recorded, ${workflowStats.patterns} patterns

**Tools**:
- \`foundry_research\` — Search docs.molt.bot for best practices
- \`foundry_implement\` — Research + implement a capability (fetches docs)
- \`foundry_write_extension\` — Create an OpenClaw extension
- \`foundry_write_skill\` — Create a skill package
- \`foundry_extend_self\` — **Write new tools into foundry itself**
- \`foundry_restart\` — Restart gateway and resume conversation
- \`foundry_evolve\` — **ADAS**: Analyze underperforming tools and generate evolved versions
- \`foundry_crystallize\` — **HexMachina**: Convert learned patterns into permanent hooks

**Outcome Learning**:
- \`foundry_track_outcome\` — Register a task (TikTok post, tweet, etc.) for feedback tracking
- \`foundry_record_feedback\` — Record engagement metrics (views, likes, etc.)
- \`foundry_get_insights\` — Get learned recommendations for a task type

When you need a new capability:
1. \`foundry_research\` — understand the API
2. \`foundry_implement\` — get implementation guidance
3. \`foundry_write_*\` or \`foundry_extend_self\` — write the code
4. \`foundry_restart\` — restart gateway to load, auto-resumes

**Feedback Loop**: After tasks like social posts, track outcomes and collect metrics. Insights will improve future runs.
**Workflow Learning**: I observe your tool sequences and suggest automation after repeated patterns.
`,
      };
    });

    // ── after_tool_call Hook ─────────────────────────────────────────────────
    // RISE: Recursive introspection with context injection
    // ADAS: Tool performance tracking for fitness evolution
    // Workflow: Track tool sequence for pattern detection
    api.on("after_tool_call", async (event: any, ctx: any) => {
      const { toolName, result, error, startTime } = event;
      const latencyMs = startTime ? Date.now() - startTime : 0;

      // Skip our own tools to avoid recursive learning
      if (toolName?.startsWith("foundry_")) return;

      // Track tool in current workflow
      learningEngine.trackWorkflowTool(toolName || "unknown");

      const isError =
        error ||
        (result && typeof result === "object" && (result as any).error);

      // ADAS: Record tool execution metrics
      learningEngine.recordToolExecution(
        toolName || "unknown",
        !isError,
        latencyMs,
      );

      if (isError) {
        const errorMsg = error || (result as any).error || "Unknown error";
        const errorStr =
          typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg);

        // RISE: Check for existing pattern before recording new failure
        const existingPattern = learningEngine.findSimilarPattern(
          toolName || "unknown",
          errorStr,
        );

        if (existingPattern && existingPattern.resolution) {
          // RISE: We have a learned pattern! Inject context for retry
          logger.info(
            `[foundry] RISE: Injecting learned pattern for ${toolName}`,
          );
          learningEngine.recordPatternUse(existingPattern.id);

          // Track which pattern was injected so we can detect success
          lastInjectedPatternId = existingPattern.id;
          lastInjectedForTool = toolName || "unknown";

          // Inject resolution into conversation context
          if (ctx?.injectSystemMessage) {
            ctx.injectSystemMessage(`
[FOUNDRY LEARNED PATTERN]
Similar error was previously resolved:
Tool: ${existingPattern.tool}
Error pattern: ${existingPattern.error?.slice(0, 100)}
Resolution: ${existingPattern.resolution}

Apply this resolution to the current failure.
`);
          }
        }

        // Record the failure with SelfEvolve feedback if available
        const feedback = (result as any)?.stderr || (result as any)?.trace;
        lastFailureId = learningEngine.recordFailure(
          toolName || "unknown",
          errorStr,
          ctx?.lastUserMessage?.slice(0, 200),
          feedback,
        );
      } else {
        // RISE: Check if this success followed a pattern injection
        if (lastInjectedPatternId && lastInjectedForTool === toolName) {
          // Pattern was used and retry succeeded!
          logger.info(
            `[foundry] RISE: Pattern ${lastInjectedPatternId} succeeded for ${toolName}`,
          );
          learningEngine.recordPatternSuccess(lastInjectedPatternId);

          // Check if pattern should be auto-crystallized
          const pattern = learningEngine.getPattern(lastInjectedPatternId);
          if (pattern && learningEngine.shouldAutoCrystallize(pattern)) {
            logger.info(
              `[foundry] RISE: Auto-crystallizing pattern ${lastInjectedPatternId} after ${pattern.useCount} successful uses`,
            );
            // Trigger crystallization - write the hook
            const hookId = `rise_crystallized_${pattern.tool}_${Date.now()}`;
            const hooksDir = join(dataDir, "hooks");
            if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

            const escapedError = (pattern.error || "")
              .replace(/`/g, "'")
              .slice(0, 100);
            const escapedResolution = (pattern.resolution || "")
              .replace(/`/g, "'")
              .slice(0, 200);

            const hookCode = `
    // RISE auto-crystallized from pattern: ${pattern.id}
    // Triggered after ${pattern.useCount} successful retry uses
    api.on("before_tool_call", async (event, ctx) => {
      if (event.toolName === "${pattern.tool}") {
        // Original error: ${escapedError}
        // Learned resolution: ${escapedResolution}
        if (ctx?.injectSystemMessage) {
          ctx.injectSystemMessage(\`
[RISE CRYSTALLIZED PATTERN]
Before calling ${pattern.tool}, apply this proven approach:
${escapedResolution}
\`);
        }
      }
    });`;

            const hookPath = join(hooksDir, `${hookId}.ts`);
            writeFileSync(hookPath, hookCode);
            learningEngine.markCrystallized(lastInjectedPatternId, hookId);
            logger.info(
              `[foundry] RISE: Wrote crystallized hook to ${hookPath}`,
            );
          }

          lastInjectedPatternId = null;
          lastInjectedForTool = null;
        }

        // Record success and potential resolution
        if (lastFailureId && toolName) {
          learningEngine.recordResolution(
            lastFailureId,
            `Succeeded after retry with ${toolName}`,
          );
          lastFailureId = null;
        }
      }
    });

    // ── agent_end Hook ───────────────────────────────────────────────────────
    // Learn from completed sessions and record workflows
    api.on("agent_end", async (event: any, ctx: any) => {
      const { outcome, toolsUsed } = event;

      // Complete workflow recording
      const workflowOutcome =
        outcome === "success"
          ? "success"
          : outcome === "failure"
            ? "failure"
            : "partial";
      learningEngine.completeWorkflow(
        workflowOutcome,
        ctx?.summary?.slice(0, 200) || "",
      );

      if (outcome === "success" && toolsUsed?.length > 2) {
        // Record successful tool combinations
        const combo = toolsUsed.slice(0, 5).join(" → ");
        learningEngine.recordInsight(
          `Successful tool sequence: ${combo}`,
          ctx?.summary?.slice(0, 200),
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
    logger.info(
      `[foundry] Written: ${writer.getExtensions().length} extensions, ${writer.getSkills().length} skills`,
    );
    logger.info(`[foundry] Learnings: ${learningEngine.getLearningsSummary()}`);

    // Check for pending session on startup
    if (learningEngine.hasPendingSession()) {
      const pending = learningEngine.getPendingSession();
      logger.info(`[foundry] ⚡ Pending session found: ${pending?.reason}`);
    }

    // Self-Improving Coding Agent (arXiv:2504.15228): Start autonomous overseer
    // Runs every hour to auto-crystallize patterns and report recurring failures
    // Run immediately once to populate lastOverseerReport for proactive evolution injection
    const initialReport = learningEngine.runOverseer(dataDir);
    logger.info(
      `[foundry] Initial overseer run: ${initialReport.evolutionCandidates.length} evolution candidates, ${initialReport.recurringFailures.length} recurring failures`,
    );

    learningEngine.startOverseer(60 * 60 * 1000, dataDir);
    logger.info(`[foundry] Autonomous overseer scheduled (1h interval)`);
  },
};
