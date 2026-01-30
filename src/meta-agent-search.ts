/**
 * Meta Agent Search (ADAS) Implementation
 *
 * Based on: "Automated Design of Agentic Systems" (arXiv:2408.08435)
 * Authors: Shengran Hu, Cong Lu, Jeff Clune
 * Acknowledgments: Rach Pradhan (insightful discussions)
 *
 * Core algorithm:
 * 1. Initialize archive with baseline agents
 * 2. Meta agent generates new agents based on archive
 * 3. Evaluate agents on tasks
 * 4. Add successful agents to archive
 * 5. Use archive to inform next generation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentDesign {
  id: string;
  name: string;
  thought: string; // Reasoning behind the design
  code: string; // The forward() function implementation
  generation: number | "initial";
  fitness: {
    accuracy: number;
    confidenceLow: number;
    confidenceHigh: number;
    evaluationCount: number;
  };
  createdAt: string;
  enabled: boolean;
}

export interface EvaluationResult {
  success: boolean;
  accuracy: number;
  errors: string[];
  duration: number;
}

export interface SearchConfig {
  maxGenerations: number;
  evaluationsPerAgent: number;
  reflexionSteps: number;
  minFitnessThreshold: number;
}

// ── Initial Archive (Baseline Agents) ────────────────────────────────────────

const INITIAL_ARCHIVE: Omit<AgentDesign, "id" | "createdAt" | "enabled">[] = [
  {
    name: "Chain-of-Thought",
    thought: "Break down complex problems into step-by-step reasoning before answering.",
    code: `
async function forward(task, context) {
  const instruction = "Please think step by step and then solve the task.";
  const response = await context.llm.complete({
    prompt: instruction + "\\n\\nTask: " + task.description,
    outputFields: ["thinking", "answer"]
  });
  return response.answer;
}`,
    generation: "initial",
    fitness: { accuracy: 0.5, confidenceLow: 0.4, confidenceHigh: 0.6, evaluationCount: 0 },
  },
  {
    name: "Self-Consistency",
    thought: "Generate multiple reasoning paths and take majority vote for robustness.",
    code: `
async function forward(task, context) {
  const instruction = "Think step by step and solve the task.";
  const responses = [];

  // Generate 3 different reasoning paths
  for (let i = 0; i < 3; i++) {
    const response = await context.llm.complete({
      prompt: instruction + "\\n\\nTask: " + task.description,
      outputFields: ["answer"],
      temperature: 0.8
    });
    responses.push(response.answer);
  }

  // Return most common answer
  const counts = {};
  for (const r of responses) {
    counts[r] = (counts[r] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}`,
    generation: "initial",
    fitness: { accuracy: 0.55, confidenceLow: 0.45, confidenceHigh: 0.65, evaluationCount: 0 },
  },
  {
    name: "Reflexion",
    thought: "Iteratively refine answer through self-critique and improvement.",
    code: `
async function forward(task, context) {
  // Initial attempt
  let response = await context.llm.complete({
    prompt: "Solve this task: " + task.description,
    outputFields: ["answer"]
  });

  // Self-critique
  const critique = await context.llm.complete({
    prompt: "Review this answer and identify any errors or improvements:\\n" +
            "Task: " + task.description + "\\n" +
            "Answer: " + response.answer,
    outputFields: ["critique", "improved_answer"]
  });

  return critique.improved_answer || response.answer;
}`,
    generation: "initial",
    fitness: { accuracy: 0.58, confidenceLow: 0.48, confidenceHigh: 0.68, evaluationCount: 0 },
  },
  {
    name: "Tool-Augmented",
    thought: "Use external tools when appropriate to enhance reasoning.",
    code: `
async function forward(task, context) {
  // Analyze if tools are needed
  const analysis = await context.llm.complete({
    prompt: "Analyze this task. Do you need external tools (search, calculate, code)?\\n" +
            "Task: " + task.description,
    outputFields: ["needs_tools", "tool_type", "reasoning"]
  });

  if (analysis.needs_tools && context.tools[analysis.tool_type]) {
    const toolResult = await context.tools[analysis.tool_type](task);
    return await context.llm.complete({
      prompt: "Using this tool result, answer the task:\\n" +
              "Task: " + task.description + "\\n" +
              "Tool result: " + toolResult,
      outputFields: ["answer"]
    }).then(r => r.answer);
  }

  // Fallback to direct answer
  return await context.llm.complete({
    prompt: "Solve: " + task.description,
    outputFields: ["answer"]
  }).then(r => r.answer);
}`,
    generation: "initial",
    fitness: { accuracy: 0.52, confidenceLow: 0.42, confidenceHigh: 0.62, evaluationCount: 0 },
  },
];

// ── Meta Agent Prompts ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful assistant that designs AI agent architectures.
You create novel agent designs by writing code that defines how an agent processes tasks.
Make sure to return responses in well-formed JSON.`;

function buildArchivePrompt(archive: AgentDesign[]): string {
  const archiveStr = archive
    .filter(a => a.enabled)
    .sort((a, b) => b.fitness.accuracy - a.fitness.accuracy)
    .slice(0, 5) // Top 5 agents
    .map(a => `
### ${a.name} (fitness: ${a.fitness.accuracy.toFixed(2)})
Thought: ${a.thought}
\`\`\`javascript
${a.code}
\`\`\`
`).join("\n");

  return `# Agent Design Task

You are designing AI agents that solve tasks. Each agent is a forward() function.

## Current Archive of Discovered Agents
${archiveStr}

## Your Task
Design a NEW agent that is interestingly different from those in the archive.
- Draw inspiration from ML/AI research literature
- Combine ideas in novel ways
- Ensure the design could plausibly outperform existing agents

## Output Format
Return a JSON object with:
{
  "name": "Agent Name",
  "thought": "Reasoning behind this design (1-2 sentences)",
  "code": "async function forward(task, context) { ... }"
}

Be creative! The best agents often combine multiple techniques in unexpected ways.`;
}

const REFLEXION_PROMPT_1 = `Review your proposed agent design:
1. Is it interestingly different from the archive agents?
2. Is the implementation correct and complete?
3. Could it plausibly achieve higher fitness?

If you see issues, provide an improved version. Otherwise, confirm the design is good.`;

const REFLEXION_PROMPT_2 = `Final review of your agent design:
1. Does the code handle edge cases?
2. Is the logic sound?
3. Would this agent be robust across different task types?

Provide your final agent design.`;

// ── Archive Manager ──────────────────────────────────────────────────────────

export class ArchiveManager {
  private archive: AgentDesign[] = [];
  private archivePath: string;

  constructor(dataDir: string) {
    this.archivePath = join(dataDir, "archive.json");
    this.load();
  }

  private load(): void {
    if (existsSync(this.archivePath)) {
      try {
        const data = JSON.parse(readFileSync(this.archivePath, "utf-8"));
        this.archive = Array.isArray(data?.agents) ? data.agents : [];
      } catch {
        this.initializeWithBaseline();
      }
    } else {
      this.initializeWithBaseline();
    }
  }

  private initializeWithBaseline(): void {
    this.archive = INITIAL_ARCHIVE.map((a, i) => ({
      ...a,
      id: `baseline-${i}`,
      createdAt: new Date().toISOString(),
      enabled: true,
    }));
    this.save();
  }

  save(): void {
    const dir = join(this.archivePath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.archivePath, JSON.stringify({ agents: this.archive }, null, 2));
  }

  add(agent: Omit<AgentDesign, "id" | "createdAt" | "enabled">): AgentDesign {
    const full: AgentDesign = {
      ...agent,
      id: `gen-${agent.generation}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    this.archive.push(full);
    this.save();
    return full;
  }

  getAll(): AgentDesign[] {
    return this.archive;
  }

  getEnabled(): AgentDesign[] {
    return this.archive.filter(a => a.enabled);
  }

  getTopPerforming(n = 5): AgentDesign[] {
    return this.getEnabled()
      .sort((a, b) => b.fitness.accuracy - a.fitness.accuracy)
      .slice(0, n);
  }

  updateFitness(id: string, result: EvaluationResult): void {
    const agent = this.archive.find(a => a.id === id);
    if (!agent) return;

    // Update running average
    const oldCount = agent.fitness.evaluationCount;
    const newCount = oldCount + 1;
    agent.fitness.accuracy = (agent.fitness.accuracy * oldCount + result.accuracy) / newCount;
    agent.fitness.evaluationCount = newCount;

    // Compute bootstrap confidence interval (simplified)
    const variance = agent.fitness.accuracy * (1 - agent.fitness.accuracy) / newCount;
    const stdErr = Math.sqrt(variance);
    agent.fitness.confidenceLow = Math.max(0, agent.fitness.accuracy - 1.96 * stdErr);
    agent.fitness.confidenceHigh = Math.min(1, agent.fitness.accuracy + 1.96 * stdErr);

    // Disable low-performing agents after sufficient evaluations
    if (newCount >= 5 && agent.fitness.accuracy < 0.3) {
      agent.enabled = false;
    }

    this.save();
  }

  buildPrompt(): string {
    return buildArchivePrompt(this.archive);
  }
}

// ── Meta Agent Search ────────────────────────────────────────────────────────

export interface LLMClient {
  complete(prompt: string, systemPrompt?: string): Promise<string>;
  completeJson<T>(prompt: string, systemPrompt?: string): Promise<T>;
}

export interface TaskEvaluator {
  evaluate(agentCode: string, tasks: unknown[]): Promise<EvaluationResult>;
}

export class MetaAgentSearch {
  private archive: ArchiveManager;
  private generation: number = 0;

  constructor(
    dataDir: string,
    private llm: LLMClient,
    private evaluator: TaskEvaluator,
    private config: SearchConfig = {
      maxGenerations: 10,
      evaluationsPerAgent: 5,
      reflexionSteps: 2,
      minFitnessThreshold: 0.3,
    },
    private logger?: { info: (msg: string) => void },
  ) {
    const archiveDir = join(dataDir, "meta-agent-search");
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }
    this.archive = new ArchiveManager(archiveDir);
  }

  async runGeneration(): Promise<AgentDesign | null> {
    this.generation++;
    this.logger?.info(`[ADAS] Starting generation ${this.generation}`);

    // Step 1: Build prompt from archive
    const prompt = this.archive.buildPrompt();

    // Step 2: Generate new agent design
    let design: { name: string; thought: string; code: string };
    try {
      design = await this.llm.completeJson<{ name: string; thought: string; code: string }>(
        prompt,
        SYSTEM_PROMPT,
      );
    } catch (e) {
      this.logger?.info(`[ADAS] Generation failed: ${e}`);
      return null;
    }

    // Step 3: Reflexion (2 passes)
    for (let i = 0; i < this.config.reflexionSteps; i++) {
      const reflexionPrompt = i === 0 ? REFLEXION_PROMPT_1 : REFLEXION_PROMPT_2;
      try {
        const refined = await this.llm.completeJson<{ name: string; thought: string; code: string }>(
          `Current design:\n${JSON.stringify(design, null, 2)}\n\n${reflexionPrompt}`,
          SYSTEM_PROMPT,
        );
        design = refined;
      } catch {
        // Keep current design if reflexion fails
      }
    }

    this.logger?.info(`[ADAS] Generated agent: ${design.name}`);

    // Step 4: Add to archive (will be evaluated separately)
    const agent = this.archive.add({
      name: design.name,
      thought: design.thought,
      code: design.code,
      generation: this.generation,
      fitness: { accuracy: 0, confidenceLow: 0, confidenceHigh: 0, evaluationCount: 0 },
    });

    return agent;
  }

  async evaluateAgent(agentId: string, tasks: unknown[]): Promise<EvaluationResult> {
    const agent = this.archive.getAll().find(a => a.id === agentId);
    if (!agent) {
      return { success: false, accuracy: 0, errors: ["Agent not found"], duration: 0 };
    }

    const result = await this.evaluator.evaluate(agent.code, tasks);
    this.archive.updateFitness(agentId, result);

    this.logger?.info(
      `[ADAS] Evaluated ${agent.name}: accuracy=${result.accuracy.toFixed(2)}`,
    );

    return result;
  }

  async runSearch(tasks: unknown[], onProgress?: (gen: number, agent: AgentDesign) => void): Promise<AgentDesign[]> {
    const discovered: AgentDesign[] = [];

    for (let i = 0; i < this.config.maxGenerations; i++) {
      // Generate new agent
      const agent = await this.runGeneration();
      if (!agent) continue;

      // Evaluate on tasks
      const result = await this.evaluateAgent(agent.id, tasks);

      // Only keep if above threshold
      if (result.accuracy >= this.config.minFitnessThreshold) {
        discovered.push(agent);
        onProgress?.(i, agent);
      }
    }

    return discovered;
  }

  getArchive(): AgentDesign[] {
    return this.archive.getAll();
  }

  getTopAgents(n = 5): AgentDesign[] {
    return this.archive.getTopPerforming(n);
  }

  getStatus(): string {
    const all = this.archive.getAll();
    const enabled = this.archive.getEnabled();
    const top = this.archive.getTopPerforming(3);

    let output = `## Meta Agent Search Status\n\n`;
    output += `- **Total agents**: ${all.length}\n`;
    output += `- **Enabled**: ${enabled.length}\n`;
    output += `- **Generation**: ${this.generation}\n\n`;

    if (top.length > 0) {
      output += `### Top Performing Agents\n\n`;
      for (const a of top) {
        output += `**${a.name}** (gen ${a.generation})\n`;
        output += `- Fitness: ${a.fitness.accuracy.toFixed(2)} `;
        output += `[${a.fitness.confidenceLow.toFixed(2)}, ${a.fitness.confidenceHigh.toFixed(2)}]\n`;
        output += `- Evaluations: ${a.fitness.evaluationCount}\n`;
        output += `- Thought: ${a.thought}\n\n`;
      }
    }

    return output;
  }
}

export { SYSTEM_PROMPT, REFLEXION_PROMPT_1, REFLEXION_PROMPT_2, buildArchivePrompt };
