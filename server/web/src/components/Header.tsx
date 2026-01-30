import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export function Header() {
  const { connected, publicKey, connect, disconnect } = useWallet();

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="logo">
          <img src="/logo.png" alt="Foundry" className="logo-icon" />
          <span>Foundry</span>
        </Link>

        <nav className="header-nav">
          <Link to="/" className="nav-link active">
            Marketplace
          </Link>
          <a
            href="https://github.com/lekt9/openclaw-foundry"
            className="nav-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://dexscreener.com/solana/2jc1lpgy1zjl9uertfdmtnm4kc2ahhydk4tqqqgbjdhh"
            className="nav-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            $FDRY
          </a>
        </nav>

        {connected ? (
          <button className="wallet-btn connected" onClick={disconnect}>
            <span className="wallet-indicator" />
            {publicKey?.slice(0, 4)}...{publicKey?.slice(-4)}
          </button>
        ) : (
          <button className="wallet-btn" onClick={connect}>
            <span className="wallet-indicator" />
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
