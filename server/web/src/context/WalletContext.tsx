import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface WalletContextType {
  connected: boolean;
  publicKey: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (tx: any) => Promise<any>;
}

const WalletContext = createContext<WalletContextType>({
  connected: false,
  publicKey: null,
  connect: async () => {},
  disconnect: () => {},
  signTransaction: async (tx) => tx,
});

export function useWallet() {
  return useContext(WalletContext);
}

function getPhantom(): any | null {
  if (typeof window !== "undefined" && (window as any).solana?.isPhantom) {
    return (window as any).solana;
  }
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const phantom = getPhantom();
    if (!phantom) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    try {
      const resp = await phantom.connect();
      setPublicKey(resp.publicKey.toString());
      setConnected(true);
    } catch (err) {
      console.error("Wallet connect failed:", err);
    }
  }, []);

  const disconnect = useCallback(() => {
    const phantom = getPhantom();
    if (phantom) {
      phantom.disconnect();
    }
    setConnected(false);
    setPublicKey(null);
  }, []);

  const signTransaction = useCallback(async (tx: any) => {
    const phantom = getPhantom();
    if (!phantom) throw new Error("Phantom wallet not found");
    return phantom.signTransaction(tx);
  }, []);

  return (
    <WalletContext.Provider value={{ connected, publicKey, connect, disconnect, signTransaction }}>
      {children}
    </WalletContext.Provider>
  );
}
