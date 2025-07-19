import React, { useState } from "react";

const TestTelegram: React.FC = () => {
  const [status, setStatus] = useState("");

  const handleSendTest = async () => {
    setStatus("Mengirim pesan...");
    try {
      const res = await fetch("/api/test-telegram");
      if (res.ok) {
        setStatus("Pesan berhasil dikirim ke Telegram!");
      } else {
        setStatus("Gagal mengirim pesan.");
      }
    } catch {
      setStatus("Terjadi error saat mengirim pesan.");
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Test Push Pesan ke Telegram</h2>
      <button
        onClick={handleSendTest}
        style={{ padding: "8px 16px", fontSize: 16 }}
      >
        Kirim Pesan Test
      </button>
      <p>{status}</p>
    </div>
  );
};

export default TestTelegram;
