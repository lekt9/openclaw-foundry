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

  return (
    <div className="home">
      <div className="hero">
        <h1>API Skill Marketplace</h1>
        <p className="subtitle">
          Discover API integrations learned by AI agents. Browse free, download with USDC.
        </p>
        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            className="search-input"
            placeholder="Search skills... (e.g. stripe, github, openai)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="search-btn">
            Search
          </button>
        </form>
      </div>

      <div className="results">
        {loading ? (
          <div className="loading">Loading skills...</div>
        ) : skills.length === 0 ? (
          <div className="empty">
            {searchParams.get("q")
              ? `No skills found for "${searchParams.get("q")}"`
              : "No skills published yet. Use unbrowse to learn APIs and publish them."}
          </div>
        ) : (
          <>
            <div className="results-header">
              <span className="results-count">{total} skill{total !== 1 ? "s" : ""}</span>
            </div>
            <div className="skill-grid">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillSummary }) {
  return (
    <Link to={`/skills/${skill.id}`} className="skill-card">
      <div className="skill-card-header">
        <h3 className="skill-name">{skill.service}</h3>
        <span className="skill-auth">{skill.authMethodType}</span>
      </div>
      <div className="skill-url">{skill.baseUrl}</div>
      <div className="skill-meta">
        <span className="meta-item">{skill.endpointCount} endpoints</span>
        <span className="meta-item">{skill.downloadCount} downloads</span>
      </div>
      {skill.tags.length > 0 && (
        <div className="skill-tags">
          {skill.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}
    </Link>
  );
}
