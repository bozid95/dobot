import React, { useState } from "react";

const Dashboard: React.FC = () => {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleMonitor = async () => {
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/binance-ema");
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
  };

  return (
    <div style={{ padding: 32 }}>
      <h1>Dashboard Bot EMA Binance</h1>
      <ul>
        <li>Jumlah pair USDT yang dipantau: 5</li>
        <li>Timeframe: 15 menit & 1 jam</li>
        <li>EMA: 7, 25, 99</li>
        <li>Notifikasi: Otomatis ke Telegram</li>
      </ul>
      <button
        onClick={handleMonitor}
        disabled={loading}
        style={{ padding: "8px 16px", fontSize: 16 }}
      >
        {loading ? "Memantau..." : "Mulai Monitoring EMA"}
      </button>
      <p style={{ marginTop: 16 }}>{result}</p>
    </div>
  );
};

export default Dashboard;
