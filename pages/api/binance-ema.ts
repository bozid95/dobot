import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import fs from "fs";
import path from "path";

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

// Global variable untuk status bot
let botRunning = true;

// API route untuk monitoring EMA cross
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Endpoint test koneksi ke Telegram bot
  if (req.query.test === "telegram") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return res
        .status(500)
        .json({ success: false, error: "Token/chatId tidak ditemukan" });
    }
    try {
      const testMsg = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text: "Test koneksi bot Telegram sukses.",
        }
      );
      if (testMsg.data && testMsg.data.ok) {
        return res
          .status(200)
          .json({ success: true, message: "Koneksi ke Telegram bot sukses." });
      } else {
        return res
          .status(500)
          .json({ success: false, error: "Gagal kirim pesan ke Telegram." });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  // Endpoint test koneksi ke Binance API
  if (req.query.test === "binance") {
    try {
      const pingRes = await axios.get("https://api.binance.com/api/v3/ping");
      if (pingRes.status === 200) {
        return res
          .status(200)
          .json({ success: true, message: "Koneksi ke Binance API sukses." });
      } else {
        return res
          .status(500)
          .json({ success: false, error: "Ping Binance gagal." });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  // Jika ada query ?action=pause atau ?action=run, update status
  if (req.query.action === "pause") {
    botRunning = false;
    return res.status(200).json({ success: true, status: "paused" });
  }
  if (req.query.action === "run") {
    botRunning = true;
    return res.status(200).json({ success: true, status: "running" });
  }
  // Jika status pause, langsung return tanpa scan
  if (!botRunning) {
    return res.status(200).json({ success: true, status: "paused" });
  }
  try {
    const pairCount = Number(req.query.pairCount) || 1000;
    const symbolsRes = await axios.get(
      "https://api.binance.com/api/v3/exchangeInfo"
    );
    const usdtPairs = symbolsRes.data.symbols
      .filter((s: any) => s.symbol.endsWith("USDT"))
      .slice(0, pairCount)
      .map((s: any) => s.symbol);

    for (const symbol of usdtPairs) {
      let tf15m = null;
      let tf1h = null;
      // Ambil data 15m
      try {
        const klines15m = await axios.get(
          "https://api.binance.com/api/v3/klines",
          { params: { symbol, interval: "15m", limit: 120 } }
        );
        const closes15m = klines15m.data.map((k: any) => parseFloat(k[4]));
        const ema7_15m = calculateEMA(closes15m, 7);
        const ema25_15m = calculateEMA(closes15m, 25);
        const ema99_15m = calculateEMA(closes15m, 99);
        const currClose = closes15m[closes15m.length - 1];
        const minDistance = currClose * 0.003;
        const dist725 = Math.abs(
          ema7_15m[ema7_15m.length - 1] - ema25_15m[ema25_15m.length - 1]
        );
        const dist799 = Math.abs(
          ema7_15m[ema7_15m.length - 1] - ema99_15m[ema99_15m.length - 1]
        );
        if (dist799 < minDistance || dist799 < dist725) tf15m = null;
        else {
          const prevEma7 = ema7_15m[ema7_15m.length - 2];
          const prevEma25 = ema25_15m[ema25_15m.length - 2];
          const prevEma99 = ema99_15m[ema99_15m.length - 2];
          const currEma7 = ema7_15m[ema7_15m.length - 1];
          const currEma25 = ema25_15m[ema25_15m.length - 1];
          const currEma99 = ema99_15m[ema99_15m.length - 1];
          const percent799 = ((currEma7 - currEma99) / currClose) * 100;
          const tpBuy799 = currClose + Math.abs(currEma7 - currEma99) * 2;
          const tpSell799 = currClose - Math.abs(currEma7 - currEma99) * 2;
          const percentProfitBuy799 =
            ((tpBuy799 - currClose) / currClose) * 100;
          const percentProfitSell799 =
            ((currClose - tpSell799) / currClose) * 100;
          const minProfitPercent = 0.2;
          // Cross up EMA7/99
          if (
            prevEma7 < prevEma99 &&
            currEma7 > currEma99 &&
            percentProfitBuy799 >= minProfitPercent
          ) {
            tf15m = {
              type: "buy",
              currClose,
              currEma7,
              currEma25,
              currEma99,
              dist799,
              percent799,
              tp: tpBuy799,
              sl: currEma99,
              percentProfit: percentProfitBuy799,
            };
          }
          // Cross down EMA7/99
          else if (
            prevEma7 > prevEma99 &&
            currEma7 < currEma99 &&
            percentProfitSell799 >= minProfitPercent
          ) {
            tf15m = {
              type: "sell",
              currClose,
              currEma7,
              currEma25,
              currEma99,
              dist799,
              percent799,
              tp: tpSell799,
              sl: currEma99,
              percentProfit: percentProfitSell799,
            };
          }
        }
      } catch (err: any) {
        tf15m = null;
      }
      // Ambil data 1h
      try {
        const klines1h = await axios.get(
          "https://api.binance.com/api/v3/klines",
          { params: { symbol, interval: "1h", limit: 120 } }
        );
        const closes1h = klines1h.data.map((k: any) => parseFloat(k[4]));
        const ema25_1h = calculateEMA(closes1h, 25);
        const ema99_1h = calculateEMA(closes1h, 99);
        const prevEma25_1h = ema25_1h[ema25_1h.length - 2];
        const currEma25_1h = ema25_1h[ema25_1h.length - 1];
        const prevEma99_1h = ema99_1h[ema99_1h.length - 2];
        const currEma99_1h = ema99_1h[ema99_1h.length - 1];
        // Trend konfirmasi
        if (currEma25_1h > currEma99_1h) tf1h = "up";
        else if (currEma25_1h < currEma99_1h) tf1h = "down";
        else tf1h = null;
      } catch (err: any) {
        tf1h = null;
      }
      // Kirim sinyal hanya jika 15m dan 1h saling mengkonfirmasi
      if (tf15m && tf1h) {
        // Ambil harga open 24 jam lalu dari candle 1h
        let percentChange24h = null;
        try {
          const klines1h24 = await axios.get(
            "https://api.binance.com/api/v3/klines",
            { params: { symbol, interval: "1h", limit: 25 } }
          );
          const open24h = parseFloat(klines1h24.data[0][1]); // open candle 24 jam lalu
          percentChange24h = ((tf15m.currClose - open24h) / open24h) * 100;
        } catch (err) {
          percentChange24h = null;
        }
        // Ambil data long/short ratio dari Binance Futures
        let longShortText = "-";
        try {
          const ratioRes = await axios.get(
            `https://fapi.binance.com/futures/data/globalLongShortAccountRatio`,
            { params: { symbol, period: "1h", limit: 1 } }
          );
          if (ratioRes.data && ratioRes.data.length > 0) {
            const longRatio = parseFloat(ratioRes.data[0].longAccount);
            const shortRatio = parseFloat(ratioRes.data[0].shortAccount);
            const total = longRatio + shortRatio;
            if (total > 0) {
              const longPercent = (longRatio / total) * 100;
              const shortPercent = (shortRatio / total) * 100;
              longShortText = `Long ${longPercent.toFixed(
                2
              )}% | Short ${shortPercent.toFixed(2)}%`;
            }
          }
        } catch (err) {
          longShortText = "-";
        }
        // Push pesan pump/dump jika persentase perubahan harga 24h sangat tinggi
        const pumpThreshold = 5; // 10% naik
        const dumpThreshold = -5; // 10% turun
        if (percentChange24h !== null && percentChange24h >= pumpThreshold) {
          const pumpMsg = `🚨 PUMP ALERT\nPair: ${symbol}\nHarga Terakhir: ${
            tf15m.currClose
          }\nPerubahan Harga 24h: ${percentChange24h.toFixed(
            2
          )}%\nLong/Short: ${longShortText}\nKeterangan: Harga naik tajam dalam 24 jam terakhir.`;
          await sendTelegramMessage(pumpMsg);
        }
        if (percentChange24h !== null && percentChange24h <= dumpThreshold) {
          const dumpMsg = `⚠️ DUMP ALERT\nPair: ${symbol}\nHarga Terakhir: ${
            tf15m.currClose
          }\nPerubahan Harga 24h: ${percentChange24h.toFixed(
            2
          )}%\nLong/Short: ${longShortText}\nKeterangan: Harga turun tajam dalam 24 jam terakhir.`;
          await sendTelegramMessage(dumpMsg);
        }
        let message = "";
        if (tf15m.type === "buy" && tf1h === "up") {
          message += `🚀 BUY SIGNAL (KONFIRMASI MULTI-TF)\nPair: ${symbol}\nTimeframe: 15m (Entry), 1h (Trend)\nHarga Terakhir: ${
            tf15m.currClose
          }\nVolume: ${tf15m.currVolume}\nEMA7: ${tf15m.currEma7.toFixed(
            4
          )} | EMA25: ${tf15m.currEma25.toFixed(
            4
          )} | EMA99: ${tf15m.currEma99.toFixed(
            4
          )}\nJarak EMA7-EMA99: ${tf15m.dist799.toFixed(
            4
          )} (${tf15m.percent799.toFixed(
            2
          )}%)\nTrend 1h: UP (EMA25 > EMA99)\nPerubahan Harga 24h: ${
            percentChange24h !== null ? percentChange24h.toFixed(2) + "%" : "-"
          }\nLong/Short: ${longShortText}\nKeterangan: EMA7 cross UP EMA99 di 15m, trend 1h UP, sinyal valid.`;
        }
        if (tf15m.type === "sell" && tf1h === "down") {
          message += `🔻 SELL SIGNAL (KONFIRMASI MULTI-TF)\nPair: ${symbol}\nTimeframe: 15m (Entry), 1h (Trend)\nHarga Terakhir: ${
            tf15m.currClose
          }\nVolume: ${tf15m.currVolume}\nEMA7: ${tf15m.currEma7.toFixed(
            4
          )} | EMA25: ${tf15m.currEma25.toFixed(
            4
          )} | EMA99: ${tf15m.currEma99.toFixed(
            4
          )}\nJarak EMA7-EMA99: ${tf15m.dist799.toFixed(
            4
          )} (${tf15m.percent799.toFixed(
            2
          )}%)\nTrend 1h: DOWN (EMA25 < EMA99)\nPerubahan Harga 24h: ${
            percentChange24h !== null ? percentChange24h.toFixed(2) + "%" : "-"
          }\nLong/Short: ${longShortText}\nKeterangan: EMA7 cross DOWN EMA99 di 15m, trend 1h DOWN, sinyal valid.`;
        }
        if (message) {
          await sendTelegramMessage(message);
        }
      }
      // Delay antar request untuk menghindari rate limit
      await new Promise((res) => setTimeout(res, 200));
    }
    res.status(200).json({ success: true, status: "running" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
