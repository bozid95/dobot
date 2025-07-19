import React, { useState } from "react";

const Home: React.FC = () => {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pairCount, setPairCount] = useState(1000);

  const handleMonitor = async () => {
    setLoading(true);
    setResult("");
    setIsRunning(true);
    try {
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

  const handlePause = () => {
    setIsRunning(false);
    setResult("Monitoring dijeda.");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="bg-white shadow-lg rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-4 text-blue-700 text-center">
          Dashboard Bot EMA Binance
        </h1>
        <ul className="mb-6 text-gray-700">
          <li>Jumlah pair USDT yang dipantau: {pairCount}</li>
          <li>Timeframe: 15 menit & 1 jam</li>
          <li>EMA: 7, 25, 99</li>
          <li>Notifikasi: Otomatis ke Telegram</li>
        </ul>
        <div className="mb-4 flex items-center justify-center">
          <label htmlFor="pairCount" className="mr-2 font-medium">
            Jumlah Pair USDT:
          </label>
          <input
            id="pairCount"
            type="number"
            min={1}
            max={1000}
            value={pairCount}
            onChange={(e) => setPairCount(Number(e.target.value))}
            className="border rounded px-2 py-1 w-20 text-center focus:outline-none focus:ring focus:border-blue-400"
          />
        </div>
        <div className="flex justify-center gap-4 mb-4">
          <button
            onClick={handleMonitor}
            disabled={loading || isRunning}
            className={`px-4 py-2 rounded font-semibold transition-colors duration-200 ${
              isRunning
                ? "bg-blue-300"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {isRunning
              ? "Sedang Running..."
              : loading
              ? "Memantau..."
              : "Mulai Monitoring EMA"}
          </button>
          <button
            onClick={handlePause}
            disabled={!isRunning}
            className="px-4 py-2 rounded font-semibold bg-gray-400 text-white hover:bg-gray-500 transition-colors duration-200"
          >
            Pause
          </button>
        </div>
        <p className="text-center text-sm text-gray-600 mt-2">
          {isRunning ? "Aplikasi sedang running..." : result}
        </p>
      </div>
    </div>
  );
};

export default Home;
