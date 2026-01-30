# Foundry — The Forge That Forges Itself

Self-writing meta-extension for Clawdbot. Researches docs, learns from failures, writes new capabilities.

## Quick Reference

### Tools
```
foundry_research       — Search docs.molt.bot
foundry_docs           — Read specific doc pages
foundry_implement      — Research + implement end-to-end
foundry_write_extension — Write new extension
foundry_write_skill    — Write API skill
foundry_add_tool       — Add tool to extension
foundry_add_hook       — Add hook to extension
foundry_extend_self    — Add capability to Foundry itself
foundry_list           — List written artifacts
foundry_restart        — Restart gateway with resume
foundry_learnings      — View patterns/insights
foundry_publish_ability — Publish to Foundry Marketplace
foundry_marketplace    — Search, leaderboard, install abilities
```

### Key Directories
```
~/.clawdbot/foundry/            — Data directory
~/.clawdbot/extensions/         — Generated extensions go here
~/.clawdbot/skills/             — Generated skills go here
~/.clawdbot/hooks/foundry-resume/ — Restart resume hook
```

## Development

### Type Check
```bash
npx tsc --noEmit
```

### Test Extension Locally
```bash
clawdbot gateway restart
tail -f ~/.clawdbot/logs/gateway.log | grep foundry
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
3. Mock Clawdbot API
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
          "dataDir": "~/.clawdbot/foundry",
          "autoLearn": true
        }
      }
    }
  }
}
```

## Learnings

- Extensions MUST go in `~/.clawdbot/extensions/` for clawdbot to discover them
- Each extension needs both `index.ts` and `clawdbot.plugin.json`
- Tools use `parameters` (not `inputSchema`) with `execute(_toolCallId, params)`
- Hooks use `api.on(event, handler)` with async handlers
- Gateway restart required to load new extensions
- Skills go in `~/.clawdbot/skills/` and work with unbrowse_replay
- Sandbox validation catches runtime errors before deployment
