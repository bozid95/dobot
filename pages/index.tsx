import React, { useState } from "react";

const Home: React.FC = () => {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pairCount, setPairCount] = useState(1000);
  const [testResult, setTestResult] = useState<string>("");

  const handleMonitor = async () => {
    setLoading(true);
    setResult("");
    try {
      // Set bot running di backend
      const resRun = await fetch(`/api/binance-ema?action=run`);
      const dataRun = await resRun.json();
      if (!resRun.ok) {
        setResult(`Error: ${dataRun.error}`);
        setLoading(false);
        return;
      }
      setIsRunning(true);
      // Mulai monitoring
      const res = await fetch(`/api/binance-ema?pairCount=${pairCount}`);
      const data = await res.json();
      if (res.ok) {
        setResult("Monitoring selesai. Cek Telegram untuk notifikasi sinyal.");
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setResult("Gagal menghubungi backend.");
    }
    setLoading(false);
    setIsRunning(false);
  };

  const handlePause = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/binance-ema?action=pause`);
      const data = await res.json();
      if (res.ok) {
        setResult("Monitoring dijeda.");
        setIsRunning(false);
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setResult("Gagal menghubungi backend.");
    }
    setLoading(false);
  };

  const handleTestTelegram = async () => {
    setTestResult("");
    setLoading(true);
    try {
      const res = await fetch("/api/binance-ema?test=telegram");
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult("✅ " + data.message);
      } else {
        setTestResult("❌ " + (data.error || "Gagal test Telegram"));
      }
    } catch (err) {
      setTestResult("❌ Gagal menghubungi backend.");
    }
    setLoading(false);
  };

  const handleTestBinance = async () => {
    setTestResult("");
    setLoading(true);
    try {
      const res = await fetch("/api/binance-ema?test=binance");
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult("✅ " + data.message);
      } else {
        setTestResult("❌ " + (data.error || "Gagal test Binance"));
      }
    } catch (err) {
      setTestResult("❌ Gagal menghubungi backend.");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          background: "#fff",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          borderRadius: "16px",
          padding: "32px",
          width: "100%",
          maxWidth: "400px",
        }}
      >
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: "bold",
            marginBottom: "1rem",
            color: "#2563eb",
            textAlign: "center",
          }}
        >
          Dashboard Bot EMA Binance
        </h1>
        <ul style={{ marginBottom: "1.5rem", color: "#374151" }}>
          <li>Jumlah pair USDT yang dipantau: {pairCount}</li>
          <li>Timeframe: 15 menit & 1 jam</li>
          <li>EMA: 7, 25, 99</li>
          <li>Notifikasi: Otomatis ke Telegram</li>
        </ul>
        <div
          style={{
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <label
            htmlFor="pairCount"
            style={{ marginRight: "0.5rem", fontWeight: "500" }}
          >
            Jumlah Pair USDT:
          </label>
          <input
            id="pairCount"
            type="number"
            min={1}
            max={1000}
            value={pairCount}
            onChange={(e) => setPairCount(Number(e.target.value))}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "4px 8px",
              width: "80px",
              textAlign: "center",
              outline: "none",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <button
            onClick={handleMonitor}
            disabled={loading || isRunning}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: "600",
              background: isRunning ? "#93c5fd" : "#2563eb",
              color: "#fff",
              border: "none",
              cursor: loading || isRunning ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {isRunning
              ? "Sedang Running..."
              : loading
              ? "Memantau..."
              : "Mulai Monitoring EMA"}
          </button>
          <button
            onClick={handlePause}
            disabled={loading || !isRunning}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: "600",
              background: "#6b7280",
              color: "#fff",
              border: "none",
              cursor: loading || !isRunning ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            Pause
          </button>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <button
            onClick={handleTestTelegram}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: "600",
              background: "#22c55e",
              color: "#fff",
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            Test Koneksi Telegram
          </button>
          <button
            onClick={handleTestBinance}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              fontWeight: "600",
              background: "#0ea5e9",
              color: "#fff",
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            Test Koneksi Binance
          </button>
        </div>
        {testResult && (
          <p
            style={{
              textAlign: "center",
              fontSize: "0.95rem",
              color: testResult.startsWith("✅") ? "#22c55e" : "#ef4444",
              marginBottom: "1rem",
            }}
          >
            {testResult}
          </p>
        )}
        <p
          style={{
            textAlign: "center",
            fontSize: "0.875rem",
            color: "#4b5563",
            marginTop: "0.5rem",
          }}
        >
          {isRunning ? "Aplikasi sedang running..." : result}
        </p>
      </div>
    </div>
  );
};

export default Home;
