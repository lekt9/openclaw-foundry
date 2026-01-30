import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { getSkillSummary, downloadSkill, type SkillDetail as SkillDetailType, type SkillPackage } from "../lib/api";
import { useWallet } from "../context/WalletContext";

export function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const { connected, publicKey, connect, signTransaction } = useWallet();
  const [skill, setSkill] = useState<SkillDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<SkillPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getSkillSummary(id)
      .then(setSkill)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDownload() {
    if (!id) return;

    if (!connected || !publicKey) {
      await connect();
      return;
    }

    setDownloading(true);
    setError(null);
    try {
      const pkg = await downloadSkill(id, signTransaction, publicKey);
      setDownloaded(pkg);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div className="detail-loading">Loading skill...</div>;
  }

  if (error && !skill) {
    return (
      <div className="detail-error">
        <p>{error}</p>
        <Link to="/" className="back-link">Back to search</Link>
      </div>
    );
  }

  if (!skill) return null;

  return (
    <div className="detail">
      <Link to="/" className="back-link">Back to search</Link>

      <div className="detail-header">
        <h1>{skill.service}</h1>
        <span className="detail-auth">{skill.authMethodType}</span>
      </div>

      <div className="detail-url">{skill.baseUrl}</div>

      <div className="detail-stats">
        <span>{skill.endpointCount} endpoints</span>
        <span>{skill.downloadCount} downloads</span>
        <span>v{skill.updatedAt?.split("T")[0]}</span>
      </div>

      {skill.tags.length > 0 && (
        <div className="detail-tags">
          {skill.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}

      <div className="detail-creator">
        <span className="label">Creator:</span>
        <code>{skill.creatorWallet}</code>
      </div>

      <h2>Endpoints</h2>
      <div className="endpoint-list">
        {skill.endpoints.map((ep, i) => (
          <div key={i} className="endpoint">
            <span className={`method method-${ep.method.toLowerCase()}`}>{ep.method}</span>
            <code className="path">{ep.path}</code>
          </div>
        ))}
      </div>

      <div className="download-section">
        {downloaded ? (
          <div className="download-success">
            <h3>Skill Package Downloaded</h3>
            <div className="download-files">
              <div className="download-file">
                <h4>SKILL.md</h4>
                <pre>{downloaded.skillMd.slice(0, 500)}{downloaded.skillMd.length > 500 ? "..." : ""}</pre>
              </div>
              <div className="download-file">
                <h4>api.ts (template)</h4>
                <pre>{downloaded.apiTemplate.slice(0, 500)}{downloaded.apiTemplate.length > 500 ? "..." : ""}</pre>
              </div>
            </div>
          </div>
        ) : (
          <>
            <button
              className="download-btn"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading
                ? "Processing payment..."
                : connected
                ? "Download Skill Package (x402 USDC)"
                : "Connect Wallet to Download"}
            </button>
            {error && <p className="download-error">{error}</p>}
            <p className="download-note">
              Requires USDC on Solana. Creator earns 3% of each download.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
