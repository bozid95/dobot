import React from "react";

const BotStatus: React.FC = () => {
  return (
    <div style={{ padding: 24 }}>
      <h1>Status Bot Telegram EMA Binance</h1>
      <ul>
        <li>Jumlah pair USDT yang dipantau: 1000</li>
        <li>Timeframe: 15 menit & 1 jam</li>
        <li>EMA: 7, 25, 99</li>
        <li>Notifikasi: Otomatis ke Telegram</li>
      </ul>
      <p>
        Silakan jalankan backend untuk mulai monitoring dan cek notifikasi di
        Telegram Anda.
      </p>
    </div>
  );
};

export default BotStatus;
