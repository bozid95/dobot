import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// Fungsi untuk menghitung EMA
function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  let emaArray: number[] = [];
  let ema = prices[0];
  emaArray.push(ema);
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }
  return emaArray;
}

// Fungsi untuk deteksi cross EMA
function detectEMACross(
  emaShort: number[],
  emaLong: number[]
): "up" | "down" | null {
  if (emaShort.length < 2 || emaLong.length < 2) return null;
  const prevDiff = emaShort[emaShort.length - 2] - emaLong[emaLong.length - 2];
  const currDiff = emaShort[emaShort.length - 1] - emaLong[emaLong.length - 1];
  if (prevDiff < 0 && currDiff > 0) return "up";
  if (prevDiff > 0 && currDiff < 0) return "down";
  return null;
}

// Fungsi untuk mengirim notifikasi ke Telegram
async function sendTelegramMessage(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
  });
}

// API route untuk monitoring EMA cross
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Ambil jumlah pair dari query, default 1000
    const pairCount = Number(req.query.pairCount) || 1000;
    const symbolsRes = await axios.get(
      "https://api.binance.com/api/v3/exchangeInfo"
    );
    const usdtPairs = symbolsRes.data.symbols
      .filter((s: any) => s.symbol.endsWith("USDT"))
      .slice(0, pairCount)
      .map((s: any) => s.symbol);

    // Untuk setiap pair, ambil data candle 15m dan 1h
    for (const symbol of usdtPairs) {
      for (const interval of ["15m", "1h"]) {
        try {
          const klinesRes = await axios.get(
            "https://api.binance.com/api/v3/klines",
            {
              params: { symbol, interval, limit: 100 },
            }
          );
          const closes = klinesRes.data.map((k: any) => parseFloat(k[4]));
          const ema7 = calculateEMA(closes, 7);
          const ema25 = calculateEMA(closes, 25);
          const ema99 = calculateEMA(closes, 99);
          // Deteksi cross EMA 7/25 dan EMA 7/99
          const cross725 = detectEMACross(ema7, ema25);
          const cross799 = detectEMACross(ema7, ema99);
          const cross2599 = detectEMACross(ema25, ema99);
          let message = "";
          if (cross725 === "up" || cross799 === "up") {
            message += `BUY SIGNAL: ${symbol} (${interval})\n`;
          }
          if (cross725 === "down" || cross799 === "down") {
            message += `SELL SIGNAL: ${symbol} (${interval})\n`;
          }
          if (cross2599 === "up" || cross2599 === "down") {
            message += `TREND CONFIRMATION: ${symbol} (${interval})\n`;
          }
          if (message) {
            await sendTelegramMessage(message);
          }
        } catch (err: any) {
          console.error(
            `Error fetching ${symbol} ${interval}:`,
            err.message,
            err.code,
            err.response?.status
          );
          continue;
        }
        // Delay antar request untuk menghindari rate limit
        await new Promise((res) => setTimeout(res, 200));
      }
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
