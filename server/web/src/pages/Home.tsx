import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { searchSkills, type SkillSummary } from "../lib/api";

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    setQuery(q);
    setLoading(true);
    searchSkills(q)
      .then((res) => {
        setSkills(res.skills);
        setTotal(res.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [searchParams]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query.trim() });
    } else {
      setSearchParams({});
    }
  }

  const totalDownloads = skills.reduce((sum, s) => sum + s.downloadCount, 0);
  const totalEndpoints = skills.reduce((sum, s) => sum + s.endpointCount, 0);

  return (
    <div className="home">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          Powered by $FDRY
        </div>
        <h1 className="hero-title">
          The <span className="highlight">Forge</span> Marketplace
        </h1>
        <p className="hero-subtitle">
          An AI agent that writes its own code. When it fails, it fixes itself.
          Every fix makes the fixer better. Browse free, download with USDC.
        </p>

        {/* Search */}
        <div className="search-container">
          <form className="search-form" onSubmit={handleSearch}>
            <span className="search-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              type="text"
              className="search-input"
              placeholder="Search abilities... (stripe, github, openai)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="search-btn">
              Search
            </button>
          </form>
        </div>

        {/* Stats */}
        <div className="stats-bar">
          <div className="stat">
            <div className="stat-value">{total}</div>
            <div className="stat-label">Skills</div>
          </div>
          <div className="stat">
            <div className="stat-value">{totalEndpoints}</div>
            <div className="stat-label">Endpoints</div>
          </div>
          <div className="stat">
            <div className="stat-value">{totalDownloads}</div>
            <div className="stat-label">Downloads</div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="results">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
            <span>Forging results...</span>
          </div>
        ) : skills.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">⚒</div>
            <div className="empty-text">
              {searchParams.get("q")
                ? `No skills found for "${searchParams.get("q")}"`
                : "No skills forged yet"}
            </div>
            <div className="empty-hint">
              Foundry learns and publishes capabilities here. Install on <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer">OpenClaw</a> to start forging.
            </div>
          </div>
        ) : (
          <>
            <div className="results-header">
              <span className="results-count">
                {total} skill{total !== 1 ? "s" : ""} found
              </span>
            </div>
            <div className="skill-grid">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillSummary }) {
  // Get initials for icon
  const initials = skill.service
    .split(/[\s-_]/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Link to={`/skills/${skill.id}`} className="skill-card">
      <div className="skill-card-header">
        <div className="skill-icon">{initials}</div>
        <div className="skill-info">
          <h3 className="skill-name">{skill.service}</h3>
          <div className="skill-url">{skill.baseUrl}</div>
        </div>
        <span className="skill-auth">{skill.authMethodType}</span>
      </div>

      <div className="skill-meta">
        <span className="meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          {skill.endpointCount} endpoints
        </span>
        <span className="meta-item">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {skill.downloadCount} downloads
        </span>
      </div>

      {skill.tags.length > 0 && (
        <div className="skill-tags">
          {skill.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
