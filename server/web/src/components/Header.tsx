import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export function Header() {
  const { connected, publicKey, connect, disconnect } = useWallet();

  return (
    <header className="header">
      <Link to="/" className="logo">
        <span className="logo-icon">{"{ }"}</span>
        <span className="logo-text">unbrowse</span>
      </Link>
      <div className="header-right">
        {connected ? (
          <button className="wallet-btn connected" onClick={disconnect}>
            {publicKey?.slice(0, 4)}...{publicKey?.slice(-4)}
          </button>
        ) : (
          <button className="wallet-btn" onClick={connect}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
