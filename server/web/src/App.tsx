import { Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { SkillDetail } from "./pages/SkillDetail";
import { Whitepaper } from "./pages/Whitepaper";
import { Header } from "./components/Header";

export function App() {
  return (
    <div className="app">
      <Header />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/whitepaper" element={<Whitepaper />} />
          <Route path="/skills/:id" element={<SkillDetail />} />
        </Routes>
      </main>
    </div>
  );
}
