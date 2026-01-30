export function Whitepaper() {
  return (
    <div className="whitepaper">
      <article className="whitepaper-content">
        <header className="whitepaper-header">
          <div className="whitepaper-badge">Research</div>
          <h1>The Case for Recursive Self-Improvement</h1>
          <p className="whitepaper-subtitle">
            How Foundry implements compound AI improvement through self-modifying agent architecture
          </p>
          <div className="whitepaper-meta">
            <span>Foundry Labs</span>
            <span>·</span>
            <span>January 2026</span>
          </div>
        </header>

        <section className="whitepaper-abstract">
          <h2>Abstract</h2>
          <p>
            Traditional AI coding tools operate linearly: an LLM writes code for you, you use it, repeat.
            Each improvement is isolated. Foundry inverts this model—the system writes code <em>for itself</em>,
            creating a compound improvement loop where each fix makes the fixer better. This paper presents
            the theoretical foundations, implementation architecture, and economic model powering the first
            self-improving AI agent marketplace.
          </p>
        </section>

        <section>
          <h2>1. The Compound Improvement Thesis</h2>
          <p>
            The history of AI research teaches a consistent lesson. In 2019, Rich Sutton articulated what
            he called "The Bitter Lesson": general methods that leverage computation ultimately outperform
            hand-crafted human knowledge, by a large margin. The implications extend beyond model training
            to agent architecture itself.
          </p>
          <p>
            Consider two approaches to building AI coding assistants:
          </p>
          <div className="comparison-table">
            <div className="comparison-row comparison-header">
              <div>Traditional AI Coding</div>
              <div>Recursive Self-Improvement</div>
            </div>
            <div className="comparison-row">
              <div>LLM writes code for you</div>
              <div>System writes code for itself</div>
            </div>
            <div className="comparison-row">
              <div>Each fix is isolated</div>
              <div>Each fix improves the fixer</div>
            </div>
            <div className="comparison-row">
              <div>Linear improvement</div>
              <div>Compound improvement</div>
            </div>
            <div className="comparison-row">
              <div>Bounded by human design</div>
              <div>Bounded by compute</div>
            </div>
          </div>
          <p>
            The second approach follows directly from the Bitter Lesson: rather than hand-designing
            agent capabilities, let the agent discover and implement them autonomously.
          </p>
        </section>

        <section>
          <h2>2. Research Foundations</h2>
          <p>
            Foundry's architecture draws from three lines of recent research demonstrating that
            self-improvement in AI systems is not only theoretically possible but empirically validated.
          </p>

          <h3>2.1 Self-Improving Coding Agents</h3>
          <p>
            Robeyns et al. (2025) demonstrated that an agent system equipped with basic coding tools
            can autonomously edit itself, improving performance on benchmark tasks by <strong>17-53%</strong> on
            SWE-Bench Verified and additional gains on LiveCodeBench.
          </p>
          <blockquote>
            "We demonstrate that an agent system, equipped with basic coding tools, can autonomously
            edit itself, and thereby improve its performance on benchmark tasks."
            <cite>— A Self-Improving Coding Agent, arXiv:2504.15228</cite>
          </blockquote>
          <p>
            The key mechanism is <em>scaffolding-based self-improvement</em>: the agent modifies its own
            orchestration code (prompts, tool definitions, control flow) rather than model weights. This
            creates a data-efficient, non-gradient-based learning mechanism that operates at deployment time.
          </p>

          <h3>2.2 Artifact-Centric Continual Learning</h3>
          <p>
            The HexMachina framework (2025) introduced a crucial architectural insight: separating
            environment discovery from strategy improvement through <em>executable artifacts</em>.
          </p>
          <blockquote>
            "Artifact-centric continual learning transforms LLMs from brittle stepwise deciders into
            stable strategy designers, advancing long-horizon autonomy."
            <cite>— HexMachina: Self-Evolving Multi-Agent System, OpenReview</cite>
          </blockquote>
          <p>
            Rather than re-interpreting state on every decision, HexMachina preserves compiled artifacts
            that encode learned strategies. This allows the LLM to focus on high-level design rather than
            per-turn execution—achieving a <strong>54% win rate</strong> against hand-crafted baselines in complex
            strategic environments.
          </p>

          <h3>2.3 Automated Design of Agentic Systems (ADAS)</h3>
          <p>
            Hu, Lu & Clune (2024) formalized the meta-learning of agent architectures through their
            Meta Agent Search algorithm: a meta-agent iteratively programs new agents based on an
            ever-growing archive of previous discoveries.
          </p>
          <blockquote>
            "Since programming languages are Turing Complete, this approach theoretically enables the
            learning of any possible agentic system: including novel prompts, tool use, workflows,
            and combinations thereof."
            <cite>— Automated Design of Agentic Systems, arXiv:2408.08435</cite>
          </blockquote>
          <p>
            ADAS agents outperformed state-of-the-art hand-designed systems across coding, science, and
            math domains—with improvements of <strong>+13.6 F1</strong> on reading comprehension and <strong>+14.4% accuracy</strong> on
            math tasks. Crucially, discovered agents maintained superior performance when transferred
            across domains and models.
          </p>
        </section>

        <section>
          <h2>3. Foundry Architecture</h2>
          <p>
            Foundry synthesizes these research directions into a unified self-improving system:
          </p>

          <div className="architecture-diagram">
            <pre>{`
  User Request
       │
       ▼
  ┌─────────────────┐
  │  Research Docs  │  ← learns OpenClaw patterns on demand
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Generate Code  │  ← writes hooks, tools, extensions
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ Sandbox Validate│  ← tests in isolation before deploy
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │     Deploy      │  ← new capability is now part of Foundry
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Pattern Learn  │  ← records failure→resolution mappings
  └────────┬────────┘
           │
           └──────────► Foundry is now better
                              │
                              ▼
                        Repeat
            `}</pre>
          </div>

          <h3>3.1 The Improvement Loop</h3>
          <ol className="improvement-loop">
            <li><strong>Observe failure</strong> — Foundry encounters an error or limitation</li>
            <li><strong>Research solution</strong> — Queries documentation, learns relevant patterns</li>
            <li><strong>Write capability</strong> — Generates a hook/tool to handle the case</li>
            <li><strong>Validate in sandbox</strong> — Tests code in isolation before deployment</li>
            <li><strong>Deploy to self</strong> — New capability becomes part of Foundry</li>
            <li><strong>Record pattern</strong> — Maps error→fix for future reference</li>
            <li><strong>Better Foundry</strong> — Now handles similar cases automatically</li>
          </ol>
          <p>
            This mirrors the HexMachina insight: each generated artifact (hook, tool, pattern) is
            preserved and reused, preventing the context window saturation that plagues prompt-centric agents.
          </p>

          <h3>3.2 Pattern Learning Engine</h3>
          <p>
            Drawing from ADAS's archive mechanism, Foundry maintains an ever-growing library of
            failure→resolution mappings:
          </p>
          <ul>
            <li><strong>Failures</strong> — Records error context and stack traces</li>
            <li><strong>Resolutions</strong> — Links successful fixes to their triggering failures</li>
            <li><strong>Patterns</strong> — Abstracts specific fixes into reusable templates</li>
            <li><strong>Context Injection</strong> — Relevant patterns are injected into future conversations</li>
          </ul>
          <p>
            Unlike traditional error handling that requires human design, Foundry discovers and
            implements error handlers autonomously—following the Bitter Lesson's prescription to
            leverage computation over hand-crafted knowledge.
          </p>
        </section>

        <section>
          <h2>4. The Forge Marketplace & x402 Protocol</h2>
          <p>
            Individual self-improvement is powerful. <em>Collective</em> self-improvement is transformative.
          </p>
          <p>
            The Forge is a marketplace where Foundry instances share discovered capabilities—skills,
            patterns, and tools—creating a network effect for AI improvement. When one Foundry learns
            to handle a new API, all Foundries can benefit.
          </p>

          <h3>4.1 Economic Model</h3>
          <p>
            The marketplace uses the <strong>x402 protocol</strong> for micropayments on Solana:
          </p>
          <ul>
            <li><strong>Browse free</strong> — Search and preview all skills without payment</li>
            <li><strong>Download with USDC</strong> — Pay creators directly via x402 Solana transactions</li>
            <li><strong>Creators earn</strong> — Publish skills, receive payment per download</li>
            <li><strong>Patterns are free</strong> — Crowdsourced learning benefits everyone</li>
          </ul>

          <h3>4.2 x402: HTTP Payment Protocol</h3>
          <p>
            x402 implements the HTTP 402 "Payment Required" status code for machine-to-machine payments:
          </p>
          <div className="code-block">
            <pre>{`
1. GET /skills/:id/download
   → 402 Payment Required
   → { accepts: [{ asset: "USDC", amount: "100000", payTo: "..." }] }

2. Build Solana transaction from requirements
3. Sign with user's wallet (Phantom)
4. Retry with X-Payment header containing signed transaction

5. GET /skills/:id/download
   Headers: { X-Payment: <base64-encoded-signed-tx> }
   → 200 OK
   → { skillMd: "...", apiTemplate: "..." }
            `}</pre>
          </div>
          <p>
            This enables instant, permissionless monetization of AI capabilities—no intermediaries,
            no subscription tiers, direct creator compensation.
          </p>

          <h3>4.3 Network Effects</h3>
          <p>
            Each skill published improves the collective capability of all Foundry instances:
          </p>
          <ul>
            <li>Creator A publishes a Stripe integration skill</li>
            <li>Creator B's Foundry downloads it, can now handle payments</li>
            <li>Creator B discovers an edge case, publishes a pattern fix</li>
            <li>Creator A's Foundry learns from the pattern</li>
            <li>Both Foundries are now better at payment handling</li>
          </ul>
          <p>
            This is <em>collective recursive self-improvement</em>: a network of agents that make each
            other better.
          </p>
        </section>

        <section>
          <h2>5. Safety & Observability</h2>
          <p>
            Self-modifying systems require robust safety mechanisms. Foundry implements multiple layers:
          </p>

          <h3>5.1 Sandbox Validation</h3>
          <p>
            All generated code is tested in an isolated process before deployment:
          </p>
          <ol>
            <li>Write to temporary directory</li>
            <li>Spawn isolated Node process</li>
            <li>Mock external APIs</li>
            <li>Attempt import and execution</li>
            <li>If fails → reject, system unchanged</li>
            <li>If passes → deploy to production</li>
          </ol>

          <h3>5.2 Security Scanning</h3>
          <p>
            Static analysis blocks dangerous patterns before execution:
          </p>
          <ul>
            <li><strong>Blocked</strong>: <code>child_process</code>, <code>exec</code>, <code>spawn</code>, <code>eval</code>, <code>new Function</code></li>
            <li><strong>Blocked</strong>: Access to <code>~/.ssh</code>, <code>~/.aws</code>, credential paths</li>
            <li><strong>Flagged</strong>: <code>process.env</code>, filesystem operations (requires review)</li>
          </ul>

          <h3>5.3 Observability</h3>
          <p>
            Following the SICA paper's recommendation, Foundry provides insight into:
          </p>
          <ul>
            <li>Chain-of-thought reasoning for each modification</li>
            <li>Full action history and sub-agent invocations</li>
            <li>Diff views of all self-modifications</li>
            <li>Pattern provenance (which failure led to which fix)</li>
          </ul>
        </section>

        <section>
          <h2>6. The Bet</h2>
          <p>
            Traditional software development: humans improve software → software does more.
          </p>
          <p>
            Foundry: software improves software → software improves <em>faster</em>.
          </p>
          <p>
            This is the core thesis. If an agent can write code that makes itself better at writing
            code, improvement compounds. Each capability acquisition makes the next acquisition easier.
            The system's growth rate accelerates over time.
          </p>
          <p>
            The research validates this is possible. SICA showed 17-53% improvement through
            self-editing. ADAS showed meta-learned agents outperform hand-designed ones. HexMachina
            showed artifact preservation enables long-horizon learning.
          </p>
          <p>
            Foundry combines these insights with an economic layer (x402/Forge) that incentivizes
            sharing improvements across a network of agents.
          </p>
          <p className="thesis-statement">
            <strong>The first AI extension that improves itself—every fix makes the fixer better.</strong>
          </p>
        </section>

        <section className="references">
          <h2>References</h2>
          <ol>
            <li>
              Robeyns, M. et al. (2025). "A Self-Improving Coding Agent."
              <em>arXiv:2504.15228</em>. ICLR 2025 Workshop.
              <a href="https://arxiv.org/abs/2504.15228" target="_blank" rel="noopener noreferrer">
                arxiv.org/abs/2504.15228
              </a>
            </li>
            <li>
              "HexMachina: Self-Evolving Multi-Agent System for Continual Learning." (2025).
              <em>OpenReview</em>.
              <a href="https://openreview.net/forum?id=V0Fb4pwhS4" target="_blank" rel="noopener noreferrer">
                openreview.net
              </a>
            </li>
            <li>
              Hu, S., Lu, C., & Clune, J. (2024). "Automated Design of Agentic Systems."
              <em>arXiv:2408.08435</em>. ICLR 2025.
              <a href="https://arxiv.org/abs/2408.08435" target="_blank" rel="noopener noreferrer">
                arxiv.org/abs/2408.08435
              </a>
            </li>
            <li>
              Sutton, R. (2019). "The Bitter Lesson."
              <a href="http://www.incompleteideas.net/IncIdeas/BitterLesson.html" target="_blank" rel="noopener noreferrer">
                incompleteideas.net
              </a>
            </li>
            <li>
              Xiang, Y. et al. (2024). "Gödel Agent: A Self-Referential Agent Framework for
              Recursive Self-Improvement." <em>arXiv:2410.04444</em>. ACL 2025.
              <a href="https://arxiv.org/abs/2410.04444" target="_blank" rel="noopener noreferrer">
                arxiv.org/abs/2410.04444
              </a>
            </li>
            <li>
              Fang, J. et al. (2025). "A Comprehensive Survey of Self-Evolving AI Agents."
              <em>arXiv:2508.07407</em>.
              <a href="https://arxiv.org/abs/2508.07407" target="_blank" rel="noopener noreferrer">
                arxiv.org/abs/2508.07407
              </a>
            </li>
          </ol>
        </section>

        <footer className="whitepaper-footer">
          <div className="footer-links">
            <a href="https://github.com/lekt9/openclaw-foundry" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href="https://dexscreener.com/solana/fdry" target="_blank" rel="noopener noreferrer">
              $FDRY on Solana
            </a>
          </div>
        </footer>
      </article>
    </div>
  );
}
