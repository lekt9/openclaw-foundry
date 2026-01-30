# Proactive Learning

Foundry doesn't just wait for commands — it actively observes, learns, and adapts to help you better.

## Learning Modes

### 1. Failure Detection
When any tool fails, Foundry automatically:
- Records the error pattern
- Captures context (what you were trying to do)
- Looks for similar past failures with resolutions
- Suggests fixes from known patterns

```
Tool: fetch_data
Error: "Connection refused"
Context: "Trying to call weather API"

Foundry observes → Records failure →
Checks patterns → Finds: "Add retry with exponential backoff"
```

### 2. Success Recognition
When you successfully fix something, Foundry:
- Links the fix to the previous failure
- Creates a pattern (error → resolution)
- Increments useCount when pattern helps again
- Auto-publishes high-value patterns (useCount > 5)

### 3. Behavior Adaptation
Foundry tracks your preferences:
- Which tools you use most
- Common error types you encounter
- How you typically solve problems
- Your coding style and patterns

## Proactive Features

### Auto-Context Injection
Before each conversation, Foundry injects:
```
[Foundry Context]
Recent patterns that might help:
- "OAuth token expired" → Refresh token before retry
- "Rate limited" → Add delay between requests

Tools you frequently use: unbrowse_replay, foundry_research
```

### Smart Suggestions
When Foundry detects patterns:
```
User: [encounters 401 error]

Foundry (proactively):
"I've seen this error 3 times before. Last time it was
fixed by refreshing the OAuth token. Want me to try that?"
```

### Auto-Fix Mode (opt-in)
```json
{
  "foundry": {
    "config": {
      "autoFix": true,
      "autoFixThreshold": 5  // Only auto-fix patterns used 5+ times
    }
  }
}
```

When enabled, Foundry will automatically apply known fixes for common errors without asking.

### Capability Gaps Detection
Foundry notices when you:
- Try to do something repeatedly that fails
- Ask for functionality that doesn't exist
- Work around missing features

```
Foundry (observing):
"You've tried to parse PDFs 3 times this week using workarounds.
Want me to add a foundry_read_pdf tool?"
```

## Learning Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                    OBSERVE                               │
│  - Tool calls (success/failure)                         │
│  - User corrections                                      │
│  - Conversation patterns                                 │
│  - Time spent on tasks                                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    ANALYZE                               │
│  - Group similar errors                                  │
│  - Identify common solutions                             │
│  - Detect usage patterns                                 │
│  - Find capability gaps                                  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                     LEARN                                │
│  - Create patterns (error → fix)                        │
│  - Record insights (what works)                         │
│  - Update preferences                                    │
│  - Build capability roadmap                              │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                     ADAPT                                │
│  - Inject context proactively                           │
│  - Suggest fixes before asked                           │
│  - Auto-apply known solutions                           │
│  - Generate missing capabilities                         │
└─────────────────────────────────────────────────────────┘
```

## Hook Implementation

### after_tool_call
```typescript
api.on("after_tool_call", async (event) => {
  const { toolName, result, error } = event;

  if (error) {
    // Record failure
    const failureId = learningEngine.recordFailure(toolName, error.message, context);

    // Look for existing pattern
    const patterns = learningEngine.findRelevantLearnings(toolName, error.message);
    if (patterns.length > 0) {
      // Proactively suggest fix
      injectSuggestion(`Try: ${patterns[0].resolution}`);
    }
  } else {
    // Check if this resolved a recent failure
    if (lastFailureId && wasResolved(result)) {
      learningEngine.recordResolution(lastFailureId, extractResolution(result));
    }

    // Record success patterns
    learningEngine.recordSuccess(toolName, summarizeContext());
  }
});
```

### before_agent_start
```typescript
api.on("before_agent_start", async (event, ctx) => {
  // Get recent patterns
  const patterns = learningEngine.getPatterns().slice(-3);
  const insights = learningEngine.getInsights().slice(-2);

  if (patterns.length > 0 || insights.length > 0) {
    ctx.systemPrompt += `
[Foundry Learnings]
${patterns.map(p => `- "${p.error}" → ${p.resolution}`).join('\n')}
${insights.map(i => `- Insight: ${i.context}`).join('\n')}
`;
  }

  // Check for capability gaps
  const gaps = detectCapabilityGaps();
  if (gaps.length > 0) {
    ctx.systemPrompt += `
[Potential Improvements]
${gaps.map(g => `- ${g.description} (seen ${g.count} times)`).join('\n')}
`;
  }
});
```

## Crowdsourced Learning

Foundry can learn from the community via Brain Marketplace:

### Publishing Patterns
When a pattern helps 5+ times:
```
Foundry: "This pattern has helped you 5 times:
  'Rate limited' → 'Add 1s delay between requests'

Publish to Brain Marketplace? (free, helps others)"
```

### Downloading Patterns
Before encountering common errors:
```
Foundry (proactively):
"I found 3 community patterns for the API you're using:
1. 'Auth header format' (47 users helped)
2. 'Pagination handling' (31 users helped)
3. 'Rate limit workaround' (28 users helped)

Install these patterns?"
```

## Configuration

```json
{
  "foundry": {
    "config": {
      "proactiveLearning": {
        "enabled": true,
        "observeToolCalls": true,
        "injectContext": true,
        "suggestFixes": true,
        "autoFix": false,
        "autoFixThreshold": 5,
        "detectCapabilityGaps": true,
        "crowdsourcedPatterns": true,
        "autoPublishThreshold": 5
      }
    }
  }
}
```

## Privacy

- All learning is local by default
- Publishing to Brain Marketplace is opt-in
- Patterns are anonymized before publishing
- No sensitive data (API keys, passwords) is ever recorded
- User can clear learnings at any time: `rm ~/.clawdbot/foundry/learnings.json`
