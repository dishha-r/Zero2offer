"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { authFetch, clearToken, getToken, getUserIdFromToken } from "../../lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // matches the backend limit

const WELCOME: Message = {
  role: "assistant",
  content:
    "Welcome to Zero2Offer. Please use the sidebar to upload your details, and I will generate your complete Readiness Report!",
};

// Open links (e.g. "Apply Here") in a new tab so the dashboard stays open
const mdComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

const errorText = (data: { detail?: unknown }) =>
  typeof data.detail === "string" ? data.detail : "Unknown error";

export default function Dashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [extraDetails, setExtraDetails] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getToken();
    const id = token ? getUserIdFromToken(token) : null;
    if (!id) {
      clearToken();
      router.push("/");
      return;
    }
    setUserId(id);

    const savedAnalysis = localStorage.getItem(`analysis_${id}`);
    if (savedAnalysis) setAnalysisResult(savedAnalysis);

    (async () => {
      try {
        const res = await authFetch("/api/history");
        if (!res.ok) {
          setMessages([WELCOME]);
          return;
        }
        const data = await res.json();
        if (data.history && data.history.length > 0) {
          setMessages(data.history.map((m: Message) => ({ role: m.role, content: m.content })));
        } else {
          setMessages([WELCOME]);
        }
      } catch (err) {
        console.error("Failed to fetch history", err);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (userId && analysisResult) {
      localStorage.setItem(`analysis_${userId}`, analysisResult);
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, analysisResult, userId]);

  const handleOnboard = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !targetRole || !userId) return;
    if (file.size > MAX_RESUME_BYTES) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "That file is larger than 5 MB. Please upload a smaller PDF." },
      ]);
      return;
    }
    setOnboardingLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: `[Initiating analysis for ${targetRole}]` }]);

    const formData = new FormData();
    formData.append("target_role", targetRole);
    formData.append("extra_details", extraDetails);
    formData.append("file", file);

    try {
      const res = await authFetch("/api/onboard", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Analysis Failed: ${errorText(data)}` }]);
        return;
      }
      setAnalysisResult(data.analysis);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Analysis complete. Data rendered in preview window. I've broken down your Strengths, Weaknesses, and provided a Roadmap.",
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error connecting to service." }]);
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleChat = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading || !userId) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Request Failed: ${errorText(data)}` }]);
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error sending message." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    if (userId) localStorage.removeItem(`analysis_${userId}`);
    clearToken();
    router.push("/");
  };

  if (!userId) return null;

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div style={{ width: "320px", borderRight: "1px solid var(--border-color)", padding: "2rem", backgroundColor: "var(--surface-color)", display: "flex", flexDirection: "column" }}>
        <h2 style={{ marginBottom: "2rem" }}>Configuration</h2>
        <form onSubmit={handleOnboard} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label className="label">Target Role</label>
          <input className="input-field" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g., Frontend Intern" required />

          <label className="label">Extra Details (Skills, constraints, etc.)</label>
          <textarea
            className="input-field"
            style={{ height: "100px", resize: "none" }}
            value={extraDetails}
            onChange={(e) => setExtraDetails(e.target.value)}
            placeholder="I know JS, React, Node. Looking for remote roles."
          />

          <label className="label">Resume (PDF, max 5 MB)</label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="input-field"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
          <button type="submit" className="btn-primary" disabled={onboardingLoading}>
            {onboardingLoading ? "Analyzing..." : "Initialize Analysis"}
          </button>
        </form>

        <div style={{ marginTop: "auto", paddingTop: "2rem" }}>
          <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>User: {userId.substring(0, 8)}</p>
          <button onClick={handleLogout} className="btn-primary" style={{ width: "100%", backgroundColor: "var(--surface-color)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ padding: "1.5rem 2rem", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--surface-color)" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Zero2Offer Career Portal</h1>
        </header>
        <div style={{ flex: 1, display: "flex", padding: "2rem", gap: "2rem", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div className="card" style={{ minHeight: "100%" }}>
              <h3>Analysis Preview</h3>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {analysisResult || "Awaiting document analysis..."}
                </ReactMarkdown>
              </div>
            </div>
          </div>
          <div className="card" style={{ width: "400px", display: "flex", flexDirection: "column" }}>
            <h3>Terminal</h3>
            <div style={{ flex: 1, overflowY: "auto", margin: "1rem 0" }}>
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: "1rem", textAlign: m.role === "user" ? "right" : "left" }}>
                  <div style={{ display: "inline-block", padding: "0.5rem 1rem", borderRadius: "8px", backgroundColor: m.role === "user" ? "var(--accent-color)" : "#f0f0f0", color: m.role === "user" ? "#fff" : "#000" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleChat} style={{ display: "flex", gap: "0.5rem" }}>
              <input className="input-field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." />
              <button type="submit" className="btn-primary">Send</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}