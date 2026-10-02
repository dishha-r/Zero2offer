"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, setToken } from "../lib/api";

export default function Home() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: "error" | "info" } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNotice({
          text: typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.",
          kind: "error",
        });
        return;
      }

      if (!data.access_token) {
        // Supabase email confirmation is on: no session until the email is confirmed
        setIsLogin(true);
        setNotice({ text: "Account created. Please confirm your email, then sign in.", kind: "info" });
        return;
      }

      setToken(data.access_token);
      router.push("/dashboard");
    } catch {
      setNotice({ text: "Could not reach the server. Please try again.", kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: "400px" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>Zero2Offer</h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>Premium Career Optimization</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label className="label">Email</label>
          <input
            className="input-field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="label">Password</label>
          <input
            className="input-field"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {notice && (
            <p
              role="alert"
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: notice.kind === "error" ? "#ef4444" : "var(--text-secondary)",
              }}
            >
              {notice.text}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
          </button>
        </form>
        <button
          onClick={() => {
            setIsLogin(!isLogin);
            setNotice(null);
          }}
          style={{ marginTop: "1rem", background: "none", border: "none", color: "var(--accent-color)", cursor: "pointer" }}
        >
          {isLogin ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
