# Foundry

**The forge that forges itself.**

[![FDRY](https://img.shields.io/badge/FDRY-Solana-9945FF)](https://dexscreener.com/solana/2jc1lpgy1zjl9uertfdmtnm4kc2ahhydk4tqqqgbjdhh)

Foundry is a self-writing meta-extension for [OpenClaw](https://github.com/lekt9/openclaw) that can research documentation, learn from failures, and write new capabilities into itself and other extensions.

**$FDRY** — [dexscreener](https://dexscreener.com/solana/2jc1lpgy1zjl9uertfdmtnm4kc2ahhydk4tqqqgbjdhh) · Solana

```
┌─────────────────────────────────────────────────────────────┐
│                         FOUNDRY                             │
│                                                             │
│   Research ──► Learn ──► Write ──► Validate ──► Deploy     │
│       │          │         │          │            │        │
│       ▼          ▼         ▼          ▼            ▼        │
│    docs.molt.bot  patterns  extensions  sandbox    gateway  │
│    arXiv papers   insights  tools       isolated   restart  │
│    GitHub repos   failures  hooks       process    resume   │
│                            skills                           │
│                            browser                          │
└─────────────────────────────────────────────────────────────┘
```

## OpenClaw vs Foundry

**OpenClaw** is the platform — an agent runtime with:
- Gateway, channels, memory, sessions
- Tool execution and skill loading
- Model providers and routing
- The infrastructure everything runs on

**Foundry** is a plugin that runs *on* OpenClaw:
- Researches docs → writes new extensions/skills/hooks
- Has its own learning engine (not part of OpenClaw core)
- Can modify itself via `foundry_extend_self`
- Publishes to Foundry Marketplace

```
OpenClaw (platform)
├── Gateway
├── Channels (Discord, Slack, Telegram...)
├── Skills & Tools
└── Plugins
    └── Foundry (this repo)
        ├── writes → extensions, skills, hooks
        ├── learns → from failures/successes
        └── publishes → to marketplace
```

**Key distinction:** OpenClaw doesn't have built-in self-learning. Foundry adds that capability on top. Foundry is an "agent that builds agents" — it uses OpenClaw's infrastructure to create new OpenClaw capabilities.

## Why Self-Writing Matters

The key insight isn't "LLM writes code for you" — it's "the system improves itself."

### Patterns vs Code

| Patterns (Knowledge) | Self-Written Code (Behavior) |
|---------------------|------------------------------|
| Stored as text | Baked into the system |
| LLM must read and apply each time | Runs automatically |
| Uses tokens every invocation | Zero token cost |
| Can be forgotten or ignored | Always executes |

A pattern says: *"When X happens, do Y."*
Self-written code **does** Y automatically when X happens.

### The Recursive Loop

```
Foundry observes failure
    ↓
Writes hook/tool to handle it
    ↓
That code becomes part of Foundry
    ↓
Foundry is now better at handling failures
    ↓
Better Foundry observes more, writes more
    ↓
Repeat
```

The system that writes the code IS the code being written.

### Why This Compounds

| External Code Generation | Self-Writing |
|-------------------------|--------------|
| LLM writes code for *you* | System writes code for *itself* |
| Linear improvement | Compound improvement |
| Each fix is isolated | Each fix improves the fixer |

**Example:**
1. Foundry fails to parse an API response
2. Writes a hook to handle that edge case
3. Now Foundry is better at parsing
4. Next time it researches an API, it parses better
5. Better parsing → better code generation → better hooks
6. Loop

### The Bet

Traditional software: Human improves software → software does more

Foundry: Software improves software → software improves faster

This is **recursive self-improvement** — each capability makes acquiring the next capability easier.

## Features

### Self-Writing Code Generation
- Writes OpenClaw extensions with tools and hooks
- Generates API skills following AgentSkills format with YAML frontmatter
- Generates browser automation skills with CDP integration
- Generates standalone hooks with HOOK.md + handler.ts pattern
- Can extend itself with new capabilities
- Validates code in isolated sandbox before deployment

### Native OpenClaw Integration
- **AgentSkills Format**: Proper YAML frontmatter with metadata (emoji, requires, events)
- **Browser Automation**: CDP-based browser tool integration for authenticated workflows
- **Skill Gating**: Auto-generates requires.config, requires.bins, requires.env for dependencies
- **Hook System**: Full support for OpenClaw hook events (gateway:startup, command:new, etc.)
- **ClawdHub Ready**: Skills can be published to the ClawdHub registry

### Proactive Learning
- Records tool failures and successful resolutions
- Builds patterns from repeated error fixes
- Shares learnings via the Foundry Marketplace
- Injects relevant context into agent conversations

### Sandbox Validation
- Runs generated code in isolated Node process
- Catches runtime errors before they crash the gateway
- Static security scanning (blocks shell exec, eval, credential access)
- Only deploys code that passes all checks

### Restart Resume
- Saves conversation context before gateway restart
- Automatically resumes after restart via managed hook
- No lost work when self-modifying

## Installation

```bash
# Clone into your OpenClaw extensions directory
git clone https://github.com/lekt9/moltbot-foundry ~/.openclaw/extensions/foundry

# Install dependencies
cd ~/.openclaw/extensions/foundry
npm install

# Add to openclaw.json
{
  "plugins": {
    "load": {
      "paths": [
        "~/.openclaw/extensions/foundry"
      ]
    }
  }
}

# Restart gateway
openclaw gateway restart
```

## Tools

### Research & Learning

| Tool | Description |
|------|-------------|
| `foundry_research` | Search docs.molt.bot for best practices and patterns |
| `foundry_docs` | Read specific documentation pages (plugin, hooks, tools, etc.) |
| `foundry_learnings` | View recorded patterns, failures, insights |

### Code Generation

| Tool | Description |
|------|-------------|
| `foundry_implement` | Research + implement a capability end-to-end |
| `foundry_write_extension` | Write a new OpenClaw extension with tools/hooks |
| `foundry_write_skill` | Write an API skill package (SKILL.md + api.ts) |
| `foundry_write_browser_skill` | Write a browser automation skill with CDP integration |
| `foundry_write_hook` | Write a standalone hook (HOOK.md + handler.ts) |
| `foundry_add_tool` | Add a tool to an existing extension |
| `foundry_add_hook` | Add a hook to an existing extension |
| `foundry_extend_self` | Add capabilities to Foundry itself |

### Management

| Tool | Description |
|------|-------------|
| `foundry_list` | List all written extensions and skills |
| `foundry_restart` | Restart gateway with context preservation |
| `foundry_publish_ability` | Publish patterns/extensions to Foundry Marketplace |
| `foundry_marketplace` | Search, browse leaderboard, and install abilities |

## Bundled Skills

Foundry ships with built-in skills that are automatically available:

### `foundry-browser-helper`
Helper skill for browser automation patterns. Provides guidance on using the OpenClaw `browser` tool effectively.

```
# Quick reference
browser open https://example.com
browser snapshot           # AI-readable format
browser click ref=btn_submit
browser type ref=input_email "user@example.com"
```

## How It Works

### 1. Research Phase
```
User: "Add a tool that fetches weather data"

Foundry:
  1. Searches docs.molt.bot for tool registration patterns
  2. Finds examples of API-calling tools
  3. Identifies best practices for error handling
```

### 2. Generation Phase
```
Foundry:
  1. Generates extension code following patterns
  2. Includes proper TypeScript types
  3. Adds error handling and logging
```

### 3. Validation Phase
```
Foundry:
  1. Static security scan (blocks dangerous patterns)
  2. Syntax validation
  3. Sandbox test (runs in isolated process)
  4. Verifies register() function works
```

### 4. Deployment Phase
```
Foundry:
  1. Writes to ~/.openclaw/extensions/
  2. Creates openclaw.plugin.json
  3. Triggers gateway restart
  4. Resumes conversation automatically
```

## Skill Generation

Foundry generates skills in the AgentSkills format with proper YAML frontmatter:

```yaml
---
name: my-api-skill
description: Integrates with My API service
metadata: {"openclaw":{"emoji":"🔌","requires":{"env":["MY_API_KEY"]}}}
---

# My API Skill

## Authentication
This skill requires the `MY_API_KEY` environment variable.

## Endpoints
- `GET /users` - List all users
- `POST /users` - Create a new user
```

### Browser Skills

Browser automation skills automatically gate on `browser.enabled`:

```yaml
---
name: my-browser-skill
description: Automates login workflow
metadata: {"openclaw":{"emoji":"🌐","requires":{"config":["browser.enabled"]}}}
---

# My Browser Skill

## Workflow
1. Open login page
2. Fill credentials
3. Submit form
4. Verify success
```

### Standalone Hooks

Hooks follow the HOOK.md + handler.ts pattern:

```
my-hook/
├── HOOK.md          # Frontmatter + documentation
└── handler.ts       # Event handler code
```

## Proactive Learning

Foundry learns from every interaction:

```typescript
// On tool failure
learningEngine.recordFailure("some_tool", "Connection refused", context);

// When you fix it
learningEngine.recordResolution(failureId, "Added retry logic with backoff");

// Pattern emerges after 3+ similar fixes
// → Foundry suggests the fix automatically next time
```

### Learning Types

| Type | Description | Auto-Published |
|------|-------------|----------------|
| **Patterns** | Error → Resolution mappings | Yes (free) |
| **Insights** | Successful approaches | No |
| **Failures** | Unresolved errors (for later) | No |

## Sandbox Security

Generated code is validated before deployment:

### Blocked Patterns (Instant Reject)
- `child_process` / `exec` / `spawn` — Shell execution
- `eval()` / `new Function()` — Dynamic code execution
- `~/.ssh/` / `id_rsa` — SSH key access
- `~/.aws/` / `aws_secret` — Cloud credentials
- Exfiltration domains (ngrok, webhook.site, etc.)

### Flagged Patterns (Warning)
- `process.env` — Environment variable access
- `fs.readFile` / `fs.writeFile` — Filesystem access
- Base64 encoding — Potential obfuscation

### Runtime Validation
```
1. Write extension to temp directory
2. Spawn isolated Node process with tsx
3. Mock OpenClaw API
4. Try to import and run register()
5. If fails → reject with error message
6. If passes → deploy to real extensions directory
```

## Foundry Marketplace

Publish and download abilities with x402 Solana USDC payments:

```bash
# Publish a pattern you discovered
foundry_publish_ability type="pattern" name="OAuth Token Refresh" patternId="pat_123"

# Search for existing patterns
foundry_marketplace action="search" query="rate limit" type="pattern"

# See the leaderboard
foundry_marketplace action="leaderboard"

# Download and apply
foundry_marketplace action="install" id="abc123"
```

### Ability Types & Pricing

| Type | Price | Description |
|------|-------|-------------|
| Pattern | FREE | Error resolution patterns (crowdsourced) |
| Technique | $0.02 | Reusable code snippets |
| Extension | $0.05 | Full OpenClaw plugins |
| Agent | $0.10 | High-fitness agent designs |

## Configuration

```json
{
  "plugins": {
    "entries": {
      "foundry": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/foundry",
          "openclawPath": "/path/to/openclaw",
          "autoLearn": true,
          "sources": {
            "docs": true,
            "experience": true,
            "arxiv": false,
            "github": false
          },
          "marketplace": {
            "url": "https://skills.molt.bot",
            "autoPublish": false
          }
        }
      }
    }
  }
}
```

### Config Options

| Option | Description | Default |
|--------|-------------|---------|
| `dataDir` | Directory to store forged artifacts | `~/.openclaw/foundry` |
| `openclawPath` | Path to OpenClaw installation for local docs | - |
| `autoLearn` | Automatically learn from agent activity | `true` |
| `sources.docs` | Learn from OpenClaw documentation | `true` |
| `sources.experience` | Learn from own successes/failures | `true` |
| `sources.arxiv` | Learn from arXiv papers | `true` |
| `sources.github` | Learn from GitHub repos | `true` |
| `marketplace.url` | Foundry marketplace URL | `https://skills.molt.bot` |
| `marketplace.autoPublish` | Auto-publish high-value patterns | `false` |

## Research Foundations

Foundry's self-improvement mechanisms draw from recent advances in autonomous learning agents:

### Self-Improving Code Agents

| Paper | Key Insight | Foundry Application |
|-------|-------------|---------------------|
| [Self-Improving Coding Agent](https://arxiv.org/abs/2504.15228) (Robeyns et al., 2025) | Agent systems with coding tools can autonomously edit themselves, achieving 17-53% improvement through "non-gradient learning via LLM reflection and code updates" | `foundry_extend_self` — the agent modifies its own codebase |
| [From Language Models to Practical Self-Improving Computer Agents](https://arxiv.org/abs/2404.11964) (Shinn et al., 2024) | LLM agents can "systematically generate software to augment themselves" starting from minimal capabilities | Self-written tools/hooks that expand Foundry's capabilities |
| [SelfEvolve](https://arxiv.org/abs/2306.02907) (Jiang et al., 2023) | Two-step pipeline: knowledge generation + self-reflection debugging using interpreter feedback | LearningEngine records failures → resolutions → patterns |

### Recursive Introspection

| Paper | Key Insight | Foundry Application |
|-------|-------------|---------------------|
| [RISE: Recursive Introspection](https://arxiv.org/abs/2407.18219) (Qu et al., 2024) | Iterative fine-tuning teaches models to "alter responses after unsuccessful attempts" via multi-turn MDPs | `after_tool_call` hook learns from failures, injects fixes |
| [HexMachina](https://arxiv.org/abs/2506.04651) (Liu et al., 2025) | "Artifact-centric continual learning" — separates discovery from strategy evolution through code refinement | Patterns (knowledge) crystallize into hooks/tools (behavior) |

### Meta-Agent Search

| Paper | Key Insight | Foundry Application |
|-------|-------------|---------------------|
| [ADAS: Automated Design of Agentic Systems](https://arxiv.org/abs/2408.08435) (Hu et al., 2024) | Meta-agent iteratively discovers improved agent designs through archive-based evolution | `meta-agent-search.ts` — evolves agent patterns in marketplace |

### Core Principle

> "An agent system, equipped with basic coding tools, can autonomously edit itself, and thereby improve its performance" — Robeyns et al.

Foundry operationalizes this: the system that writes the code IS the code being written.

## Key Directories

```
~/.openclaw/foundry/            — Data directory (learnings, patterns)
~/.openclaw/extensions/         — Generated extensions go here
~/.openclaw/skills/             — Generated skills go here
~/.openclaw/hooks/foundry-resume/ — Restart resume hook
```

## Development

```bash
# Type check
npx tsc --noEmit

# Test extension locally
openclaw gateway restart
tail -f ~/.openclaw/logs/gateway.log | grep foundry
```

## License

MIT

---

*Built with OpenClaw. Forged by Foundry.*
