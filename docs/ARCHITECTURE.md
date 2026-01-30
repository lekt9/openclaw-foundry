# Foundry Architecture

## Overview

Foundry is a self-writing meta-extension that can research, learn, and generate new capabilities for Clawdbot.

```
┌──────────────────────────────────────────────────────────────────┐
│                           FOUNDRY                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   DocsFetcher │  │  CodeWriter │  │LearningEngine│              │
│  │             │  │             │  │             │              │
│  │ - fetch()   │  │ - extension │  │ - patterns  │              │
│  │ - search()  │  │ - skill     │  │ - insights  │              │
│  │ - cache     │  │ - tool      │  │ - failures  │              │
│  └─────────────┘  │ - hook      │  │ - successes │              │
│                   └─────────────┘  └─────────────┘              │
│                          │                │                      │
│                          ▼                ▼                      │
│                   ┌─────────────┐  ┌─────────────┐              │
│                   │CodeValidator│  │ PendingSession│              │
│                   │             │  │             │              │
│                   │ - static    │  │ - context   │              │
│                   │ - sandbox   │  │ - resume    │              │
│                   └─────────────┘  └─────────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. DocsFetcher

Fetches and caches documentation from docs.molt.bot.

```typescript
class DocsFetcher {
  private cache: Map<string, { content: string; fetchedAt: number }>;
  private cacheTtl = 30 * 60 * 1000; // 30 minutes

  async fetchPage(path: string): Promise<string>;
  async fetchForTopic(topic: string): Promise<string>;
  async search(query: string): Promise<string>;
}
```

**Topics Mapped:**
- `plugin` → /tools/plugin
- `hooks` → /automation/hooks
- `tools` → /tools/tools, /tools/lobster, /tools/exec
- `browser` → /tools/browser, /tools/browser-login
- `skills` → /tools/skills, /tools/skills-config
- `agent` → /concepts/agent, /concepts/agent-loop
- `gateway` → /gateway/gateway, /gateway/configuration
- `channels` → /channels/index, /channels/whatsapp, /channels/telegram

### 2. CodeWriter

Generates and manages extensions, skills, tools, and hooks.

```typescript
class CodeWriter {
  private manifest: { extensions: ExtensionDef[]; skills: SkillDef[] };
  private extensionsDir: string;  // ~/.clawdbot/extensions
  private skillsDir: string;       // ~/.clawdbot/skills

  async writeExtension(def: ExtensionDef, validator?: CodeValidator): Promise<{ path: string; validation: ValidationResult }>;
  writeSkill(def: SkillDef): string;
  addTool(extensionId: string, tool: ToolDef): boolean;
  addHook(extensionId: string, hook: HookDef): boolean;
}
```

**Extension Structure:**
```typescript
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
  event: string;  // "before_agent_start" | "after_tool_call" | "agent_end"
  code: string;
}
```

### 3. LearningEngine

Records and retrieves patterns from successes and failures.

```typescript
class LearningEngine {
  private learnings: LearningEntry[];
  private pendingSession: PendingSession | null;

  recordFailure(tool: string, error: string, context?: string): string;
  recordResolution(failureId: string, resolution: string): void;
  recordSuccess(tool: string, context: string): void;
  recordInsight(insight: string, context?: string): void;
  findRelevantLearnings(tool?: string, errorPattern?: string): LearningEntry[];
  getPatterns(): LearningEntry[];
  getInsights(): LearningEntry[];
}
```

**Learning Entry Types:**
```typescript
interface LearningEntry {
  id: string;
  type: "failure" | "pattern" | "insight" | "success";
  tool?: string;
  error?: string;
  resolution?: string;
  context?: string;
  timestamp: string;
  useCount?: number;
}
```

### 4. CodeValidator

Validates generated code before deployment.

```typescript
class CodeValidator {
  async validate(code: string, type: "extension" | "tool" | "hook"): Promise<ValidationResult>;
  async testInSandbox(code: string, tempDir: string): Promise<{ success: boolean; error?: string }>;
  private staticSecurityScan(code: string): { blocked: string[]; flagged: string[] };
}
```

**Validation Pipeline:**
1. **Syntax Check** — Parse as JavaScript function
2. **Security Scan** — Check for dangerous patterns
3. **Structure Check** — Verify export default, registerTool, etc.
4. **Sandbox Test** — Run in isolated process

## Data Flow

### Writing an Extension

```
1. User Request
   │
   ▼
2. foundry_research (optional)
   │  Fetch relevant docs from docs.molt.bot
   │
   ▼
3. foundry_write_extension
   │
   ├─► Generate code from template
   │
   ├─► CodeValidator.validate()
   │   ├─ Syntax check
   │   ├─ Security scan
   │   └─ Structure check
   │
   ├─► CodeValidator.testInSandbox()
   │   ├─ Write to temp dir
   │   ├─ Spawn isolated process
   │   ├─ Mock Clawdbot API
   │   ├─ Try to load extension
   │   └─ Return success/error
   │
   ├─► Write to ~/.clawdbot/extensions/{id}/
   │   ├─ index.ts
   │   └─ clawdbot.plugin.json
   │
   └─► foundry_restart (optional)
       └─ Restart gateway with resume context
```

### Learning from Failure

```
1. Tool Call Fails
   │
   ▼
2. after_tool_call Hook
   │  LearningEngine.recordFailure()
   │
   ▼
3. User Fixes Issue
   │
   ▼
4. agent_end Hook
   │  Check if last failure was resolved
   │  LearningEngine.recordResolution()
   │
   ▼
5. Pattern Created (if similar fixes > 3)
   │
   ▼
6. before_agent_start Hook (next conversation)
   │  Inject relevant patterns as context
```

## File Structure

```
~/.clawdbot/
├── foundry/                     # Foundry data directory
│   ├── manifest.json            # Registry of written artifacts
│   │   {
│   │     "extensions": [...],
│   │     "skills": [...]
│   │   }
│   ├── learnings.json           # Learning entries
│   │   [
│   │     { "id": "...", "type": "pattern", ... }
│   │   ]
│   ├── pending-session.json     # Resume context (temporary)
│   │   {
│   │     "agentId": "...",
│   │     "context": "...",
│   │     "reason": "...",
│   │     "lastMessage": "..."
│   │   }
│   └── sandbox/                 # Temporary test directory
│       └── sandbox_{timestamp}/ # Ephemeral, auto-cleaned
│
├── extensions/                  # Generated extensions
│   └── {extension-id}/
│       ├── index.ts             # Extension code
│       └── clawdbot.plugin.json # Plugin manifest
│
├── skills/                      # Generated skills
│   └── {skill-name}/
│       ├── SKILL.md             # Skill documentation
│       ├── auth.json            # Auth headers (if any)
│       └── scripts/
│           └── api.ts           # API client code
│
└── hooks/
    └── foundry-resume/          # Restart resume hook
        ├── handler.ts           # Hook implementation
        └── HOOK.md              # Hook metadata
```

## Security Model

### Blocked Patterns (Instant Reject)
| Pattern | Reason |
|---------|--------|
| `child_process` | Shell execution |
| `exec`, `spawn`, `execSync` | Command execution |
| `eval()` | Dynamic code execution |
| `new Function()` | Dynamic function creation |
| `~/.ssh/`, `id_rsa` | SSH key access |
| `~/.aws/`, `aws_secret` | Cloud credentials |
| `ngrok`, `webhook.site` | Exfiltration domains |

### Flagged Patterns (Warning)
| Pattern | Reason |
|---------|--------|
| `process.env` | Environment access |
| `fs.readFile`, `fs.writeFile` | Filesystem access |
| `atob`, `btoa`, `Buffer.from` | Encoding (potential obfuscation) |

### Sandbox Isolation
- Runs in separate Node process
- 15-second timeout
- Mocked Clawdbot API
- No network access from sandbox
- Temp files auto-cleaned

## Integration Points

### Clawdbot API
```typescript
// Tool registration
api.registerTool(tools, { names: toolNames });

// Hook registration
api.on("before_agent_start", async (event, ctx) => { ... });
api.on("after_tool_call", async (event) => { ... });
api.on("agent_end", async (event) => { ... });
```

### Brain Marketplace
```typescript
// Publish pattern
POST /skills/publish
{
  "abilityType": "pattern",
  "service": "Pattern Name",
  "content": { errorPattern, resolution, ... },
  "creatorWallet": "..."
}

// Search patterns
GET /skills/search?q=rate+limit&type=pattern
```

### Gateway Restart
```typescript
// Save context before restart
learningEngine.savePendingSession({
  agentId,
  context,
  reason: "Self-modification",
  lastMessage
});

// Resume via foundry-resume hook
// → Reads pending-session.json
// → Injects resume message into conversation
```
