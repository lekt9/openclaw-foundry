# Foundry — The Forge That Forges Itself

Self-writing meta-extension for OpenClaw. Researches docs, learns from failures, writes new capabilities.

## Quick Reference

### Tools
```
foundry_research         — Search docs.openclaw.ai (fetches llms.txt index)
foundry_docs             — Read specific doc pages
foundry_implement        — Research + implement end-to-end
foundry_write_extension  — Write new extension
foundry_write_skill      — Write OpenClaw/AgentSkills-compatible skill
foundry_write_browser_skill — Write browser automation skill (gated on browser.enabled)
foundry_write_hook       — Write standalone hook (HOOK.md + handler.ts)
foundry_add_tool         — Add tool to extension
foundry_add_hook         — Add hook to extension
foundry_extend_self      — Add capability to Foundry itself
foundry_list             — List written artifacts
foundry_restart          — Restart gateway with resume
foundry_learnings        — View patterns/insights
foundry_publish_ability  — Publish to Foundry Marketplace
foundry_marketplace      — Search, leaderboard, install abilities
```

### Key Directories
```
~/.openclaw/foundry/            — Data directory
~/.openclaw/extensions/         — Generated extensions go here
~/.openclaw/skills/             — Generated skills go here
~/.openclaw/hooks/              — Generated hooks go here
~/.openclaw/hooks/foundry-resume/ — Restart resume hook
./skills/                       — Bundled skills (shipped with plugin)
```

## Development

### Type Check
```bash
npx tsc --noEmit
```

### Test Extension Locally
```bash
openclaw gateway restart
tail -f ~/.openclaw/logs/gateway.log | grep foundry
```

## Architecture

```
User Request
     │
     ▼
Research (docs.molt.bot)
     │
     ▼
Generate Code (templates)
     │
     ▼
Validate (static + sandbox)
     │
     ▼
Deploy (write to extensions/)
     │
     ▼
Restart Gateway (with resume)
```

## Key Classes

### DocsFetcher
Fetches docs.molt.bot with 30-minute cache:
```
Available topics: plugin, hooks, tools, browser, skills, agent, gateway, channels, memory, automation
```

### CodeWriter
Generates extensions/skills/tools. Validates in sandbox before writing.

### LearningEngine
Records patterns from failures/successes. Injects context into conversations.

### CodeValidator
Static security scan + isolated process sandbox testing.

## Sandbox Validation

Extensions are tested in isolated process before deployment:
1. Write to temp directory
2. Spawn Node process with tsx
3. Mock OpenClaw API
4. Try to import and run register()
5. If fails → reject, gateway stays safe
6. If passes → deploy to real extensions

## Proactive Learning

Foundry observes tool calls and learns:
- **Failures** → Records error + context
- **Resolutions** → Links fix to failure → Creates pattern
- **Patterns** → Injected as context in future conversations
- **Auto-publish** → Shares high-value patterns to Foundry Marketplace (opt-in)

### How It Adapts
1. Observes tool failures and successes
2. Records patterns (error → fix mappings)
3. Injects relevant patterns into agent context
4. Suggests fixes proactively when similar errors occur
5. Publishes high-value patterns to help others

## Security

Blocked patterns (instant reject):
- `child_process`, `exec`, `spawn` — Shell execution
- `eval`, `new Function` — Dynamic code
- `~/.ssh`, `~/.aws` — Credential access

Flagged patterns (warning):
- `process.env` — Environment access
- `fs.readFile`, `fs.writeFile` — Filesystem access

## Integration

### Foundry Marketplace
```typescript
// Publish pattern
foundry_publish_ability type="pattern" name="..." patternId="pat_123"

// Search community patterns
foundry_marketplace action="search" query="rate limit" type="pattern"

// See leaderboard (ranked by unique payers)
foundry_marketplace action="leaderboard"

// Install ability (x402 USDC payment)
foundry_marketplace action="install" id="abc123"
```

### Marketplace Server
Located in `foundry/server/` — Bun HTTP server with x402 Solana payments.

### Restart Resume
```typescript
// Saves context before restart
learningEngine.savePendingSession({ context, reason, lastMessage });

// foundry-resume hook injects resume message on startup
```

## Example: Write an Extension

```
1. Research what you need:
   foundry_research query="how to register tools"

2. Implement:
   foundry_write_extension({
     id: "my-tool",
     name: "My Tool",
     description: "Does something useful",
     tools: [{
       name: "do_thing",
       description: "Does the thing",
       properties: { input: { type: "string", description: "Input" } },
       required: ["input"],
       code: `return { content: [{ type: "text", text: p.input }] };`
     }],
     hooks: []
   })

3. Restart:
   foundry_restart reason="Added my-tool extension"
```

## Example: Self-Modification

```
foundry_extend_self({
  action: "add_tool",
  toolName: "foundry_my_feature",
  toolDescription: "My new feature",
  toolParameters: { ... },
  toolCode: `...`
})
```

## Config

```json
{
  "plugins": {
    "entries": {
      "foundry": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/foundry",
          "autoLearn": true
        }
      }
    }
  }
}
```

## Example: Write a Skill (OpenClaw-compatible)

Skills follow the [AgentSkills](https://agentskills.io) / OpenClaw format with YAML frontmatter.

### General Skill
```typescript
foundry_write_skill({
  name: "my-skill",
  description: "Does something useful",
  content: "## How to use\n\nInstructions here...\n\nUse `{baseDir}` to reference skill folder.",
  metadata: {
    openclaw: {
      requires: { bins: ["node"], env: ["API_KEY"] },
      primaryEnv: "API_KEY"
    }
  }
})
```

### API-based Skill (Legacy)
```typescript
foundry_write_skill({
  name: "my-api",
  description: "API integration",
  baseUrl: "https://api.example.com",
  endpoints: [
    { method: "GET", path: "/users/{id}", description: "Get user by ID" },
    { method: "POST", path: "/users", description: "Create user" }
  ],
  authHeaders: { "Authorization": "Bearer ${API_KEY}" }
})
```

### Skill Frontmatter Options
```yaml
---
name: my-skill
description: What the skill does
homepage: https://example.com
user-invocable: true
disable-model-invocation: false
command-dispatch: tool
command-tool: my_tool
command-arg-mode: raw
metadata: {"openclaw":{"requires":{"bins":["node"],"env":["API_KEY"]},"primaryEnv":"API_KEY"}}
---
```

### Gating (metadata.openclaw.requires)
- `bins` — Required binaries on PATH
- `anyBins` — At least one must be on PATH
- `env` — Required environment variables
- `config` — Required config paths in openclaw.json

## Example: Write a Browser Skill

Browser skills use the OpenClaw `browser` tool for web automation.

```typescript
foundry_write_browser_skill({
  name: "twitter-poster",
  description: "Post tweets via browser automation",
  targetUrl: "https://twitter.com",
  actions: [
    {
      name: "Post Tweet",
      description: "Create and post a new tweet",
      steps: [
        "browser open https://twitter.com/compose/tweet",
        "browser snapshot",
        "browser type ref=tweet_input 'Your tweet content'",
        "browser click ref=post_button"
      ]
    }
  ],
  authMethod: "manual",
  authNotes: "Sign in to Twitter in the openclaw browser profile first"
})
```

Browser skills are automatically gated on `browser.enabled` config.

## Example: Write a Hook

Hooks trigger on OpenClaw events like `command:new`, `gateway:startup`, etc.

```typescript
foundry_write_hook({
  name: "welcome-message",
  description: "Send welcome message on new sessions",
  events: ["command:new"],
  code: `const handler: HookHandler = async (event: HookEvent) => {
  if (event.type !== 'command' || event.action !== 'new') return;
  event.messages.push('Welcome! I am ready to help.');
};`,
  metadata: { openclaw: { emoji: "👋" } }
})
```

Enable with: `openclaw hooks enable welcome-message`

### Available Hook Events
- `command:new` — New session/command started
- `command:reset` — Session reset
- `command:stop` — Session stopped
- `agent:bootstrap` — Before workspace file injection
- `gateway:startup` — After channels load
- `tool_result_persist` — Before tool result is persisted

## Learnings

- Extensions MUST go in `~/.openclaw/extensions/` for openclaw to discover them
- Each extension needs both `index.ts` and `openclaw.plugin.json`
- Tools use `parameters` (not `inputSchema`) with `execute(_toolCallId, params)`
- Extension hooks use `api.on(event, handler)` with async handlers
- Standalone hooks use `HOOK.md` + `handler.ts` pattern in `~/.openclaw/hooks/`
- Gateway restart required to load new extensions
- Skills go in `~/.openclaw/skills/` with proper SKILL.md frontmatter
- Skills use AgentSkills/OpenClaw format with YAML frontmatter (name + description required)
- Metadata must be single-line JSON per OpenClaw spec
- Sandbox validation catches runtime errors before deployment
- Browser skills require `browser.enabled` config
- Use `{baseDir}` in skill content to reference the skill folder
- Plugins can ship skills via `skills` array in openclaw.plugin.json
