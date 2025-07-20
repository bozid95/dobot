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
    const pairCount = Number(req.query.pairCount) || 1000;
    const symbolsRes = await axios.get(
      "https://api.binance.com/api/v3/exchangeInfo"
    );
    const usdtPairs = symbolsRes.data.symbols
      .filter((s: any) => s.symbol.endsWith("USDT"))
      .slice(0, pairCount)
      .map((s: any) => s.symbol);

    // Proses semua pair secara paralel
    const sentSignals = new Set();
    await Promise.all(
      usdtPairs.map(async (symbol) => {
        try {
          // --- Ambil data 15m ---
          const klines15m = await axios.get(
            "https://api.binance.com/api/v3/klines",
            { params: { symbol, interval: "15m", limit: 120 } }
          );
          const closes15m = klines15m.data.map((k: any) => parseFloat(k[4]));
          const volumes15m = klines15m.data.map((k: any) => parseFloat(k[5]));
          const volume15m = volumes15m[volumes15m.length - 1];
          const currClose = closes15m[closes15m.length - 1];
          function calculateRSI(closes: number[], period: number): number {
            let gains = 0;
            let losses = 0;
            for (let i = closes.length - period; i < closes.length - 1; i++) {
              const diff = closes[i + 1] - closes[i];
              if (diff > 0) gains += diff;
              else losses -= diff;
            }
            const avgGain = gains / period;
            const avgLoss = losses / period;
            if (avgLoss === 0) return 100;
            const rs = avgGain / avgLoss;
            return 100 - 100 / (1 + rs);
          }
          const rsi15m = calculateRSI(closes15m, 14);
          const ema7_15m = calculateEMA(closes15m, 7);
          const ema25_15m = calculateEMA(closes15m, 25);
          const ema99_15m = calculateEMA(closes15m, 99);
          // --- Kelengkungan EMA ---
          let curvatureEma7 = null;
          if (ema7_15m.length >= 3) {
            const slopePrev =
              ema7_15m[ema7_15m.length - 2] - ema7_15m[ema7_15m.length - 3];
            const slopeCurr =
              ema7_15m[ema7_15m.length - 1] - ema7_15m[ema7_15m.length - 2];
            const deltaSlope = slopeCurr - slopePrev;
            if (deltaSlope > 0.0001) curvatureEma7 = "naik tajam";
            else if (deltaSlope < -0.0001) curvatureEma7 = "turun tajam";
            else curvatureEma7 = "datar";
          }
          let curvatureEma25 = null;
          if (ema25_15m.length >= 3) {
            const slopePrev =
              ema25_15m[ema25_15m.length - 2] - ema25_15m[ema25_15m.length - 3];
            const slopeCurr =
              ema25_15m[ema25_15m.length - 1] - ema25_15m[ema25_15m.length - 2];
            const deltaSlope = slopeCurr - slopePrev;
            if (deltaSlope > 0.0001) curvatureEma25 = "naik tajam";
            else if (deltaSlope < -0.0001) curvatureEma25 = "turun tajam";
            else curvatureEma25 = "datar";
          }
          let curvatureEma99 = null;
          if (ema99_15m.length >= 3) {
            const slopePrev =
              ema99_15m[ema99_15m.length - 2] - ema99_15m[ema99_15m.length - 3];
            const slopeCurr =
              ema99_15m[ema99_15m.length - 1] - ema99_15m[ema99_15m.length - 2];
            const deltaSlope = slopeCurr - slopePrev;
            if (deltaSlope > 0.0001) curvatureEma99 = "naik tajam";
            else if (deltaSlope < -0.0001) curvatureEma99 = "turun tajam";
            else curvatureEma99 = "datar";
          }

          // --- Ambil data 1h ---
          const klines1h = await axios.get(
            "https://api.binance.com/api/v3/klines",
            { params: { symbol, interval: "1h", limit: 120 } }
          );
          const closes1h = klines1h.data.map((k: any) => parseFloat(k[4]));
          const ema7_1h = calculateEMA(closes1h, 7);
          const ema25_1h = calculateEMA(closes1h, 25);
          const ema99_1h = calculateEMA(closes1h, 99);
          // --- Deteksi cross EMA7/EMA25 di 1h ---
          let cross1h_7_25 = null;
          if (ema7_1h.length >= 2 && ema25_1h.length >= 2) {
            if (
              ema7_1h[ema7_1h.length - 2] < ema25_1h[ema25_1h.length - 2] &&
              ema7_1h[ema7_1h.length - 1] > ema25_1h[ema25_1h.length - 1]
            ) {
              cross1h_7_25 = "buy";
            } else if (
              ema7_1h[ema7_1h.length - 2] > ema25_1h[ema25_1h.length - 2] &&
              ema7_1h[ema7_1h.length - 1] < ema25_1h[ema25_1h.length - 1]
            ) {
              cross1h_7_25 = "sell";
            }
          }
          // --- Deteksi cross EMA7/EMA99 di 1h ---
          let cross1h_7_99 = null;
          if (ema7_1h.length >= 2 && ema99_1h.length >= 2) {
            if (
              ema7_1h[ema7_1h.length - 2] < ema99_1h[ema99_1h.length - 2] &&
              ema7_1h[ema7_1h.length - 1] > ema99_1h[ema99_1h.length - 1]
            ) {
              cross1h_7_99 = "buy";
            } else if (
              ema7_1h[ema7_1h.length - 2] > ema99_1h[ema99_1h.length - 2] &&
              ema7_1h[ema7_1h.length - 1] < ema99_1h[ema99_1h.length - 1]
            ) {
              cross1h_7_99 = "sell";
            }
          }
          // --- Deteksi cross EMA25/EMA99 di 1h ---
          let cross1h_25_99 = null;
          if (ema25_1h.length >= 2 && ema99_1h.length >= 2) {
            if (
              ema25_1h[ema25_1h.length - 2] < ema99_1h[ema99_1h.length - 2] &&
              ema25_1h[ema25_1h.length - 1] > ema99_1h[ema99_1h.length - 1]
            ) {
              cross1h_25_99 = "buy";
            } else if (
              ema25_1h[ema25_1h.length - 2] > ema99_1h[ema99_1h.length - 2] &&
              ema25_1h[ema25_1h.length - 1] < ema99_1h[ema99_1h.length - 1]
            ) {
              cross1h_25_99 = "sell";
            }
          }

          // --- Deteksi dan push crossing EMA7/EMA25 ---
          for (let i = ema7_15m.length - 10; i < ema7_15m.length - 1; i++) {
            let cross15m = null;
            if (
              ema7_15m[i - 1] < ema25_15m[i - 1] &&
              ema7_15m[i] > ema25_15m[i]
            )
              cross15m = "buy";
            if (
              ema7_15m[i - 1] > ema25_15m[i - 1] &&
              ema7_15m[i] < ema25_15m[i]
            )
              cross15m = "sell";
            if (
              cross15m &&
              isValidTimeframeCombo({ cross15m, cross1h: cross1h_7_25 })
            ) {
              const candleAfterCross = ema7_15m.length - 1 - i;
              const signalKey = `${symbol}-EMA7/EMA25-${cross15m}-${i}`;
              if (
                candleAfterCross <= 4 &&
                candleAfterCross >= 0 &&
                isValidSignal({
                  currClose: currClose,
                  emaShort: ema7_15m[ema7_15m.length - 1],
                  emaLong: ema25_15m[ema25_15m.length - 1],
                  volume: volume15m,
                  rsi: rsi15m,
                  curvatureShort: curvatureEma7,
                  curvatureLong: curvatureEma25,
                }) &&
                !sentSignals.has(signalKey)
              ) {
                sentSignals.add(signalKey);
                // Ambil ratio long/short
                let longShortRatioText = "";
                try {
                  const ratioRes = await axios.get(
                    "https://fapi.binance.com/futures/data/globalLongShortAccountRatio",
                    { params: { symbol, period: "15m", limit: 1 } }
                  );
                  if (ratioRes.data && ratioRes.data.length > 0) {
                    const ratio = ratioRes.data[0];
                    longShortRatioText =
                      "Long/Short Ratio: " +
                      Number(ratio.longShortRatio).toFixed(2) +
                      " (Long: " +
                      Number(ratio.longAccount).toFixed(0) +
                      ", Short: " +
                      Number(ratio.shortAccount).toFixed(0) +
                      ")";
                  }
                } catch (err) {
                  longShortRatioText = "Long/Short Ratio: -";
                }
                let msg =
                  (cross15m === "buy" ? "BUY " : "SELL ") +
                  "EMA7/EMA25\nPair: " +
                  symbol +
                  "\nTimeframe: 15m\nHarga: " +
                  currClose +
                  "\nEMA7: " +
                  ema7_15m[ema7_15m.length - 1].toFixed(4) +
                  " | EMA25: " +
                  ema25_15m[ema25_15m.length - 1].toFixed(4) +
                  "\nVolume: " +
                  volume15m.toFixed(2) +
                  "\nRSI: " +
                  (rsi15m !== undefined ? rsi15m.toFixed(2) : "-") +
                  "\nKelengkungan EMA7: " +
                  curvatureEma7 +
                  "\nKelengkungan EMA25: " +
                  curvatureEma25 +
                  "\nCandle setelah cross: " +
                  candleAfterCross +
                  "\n" +
                  longShortRatioText +
                  "\nRekomendasi Entry: " +
                  (candleAfterCross <= 2
                    ? "Segera entry di harga saat ini"
                    : "Sudah terlewat beberapa candle, jika kamu yakin entry ya gpp sih..") +
                  "\nHarga entry terbaik: " +
                  currClose;
                await sendTelegramMessage(msg);
              }
            }
          }
          // --- Deteksi dan push crossing EMA7/EMA99 ---
          for (let i = ema7_15m.length - 10; i < ema7_15m.length - 1; i++) {
            let cross15m = null;
            if (
              ema7_15m[i - 1] < ema99_15m[i - 1] &&
              ema7_15m[i] > ema99_15m[i]
            )
              cross15m = "buy";
            if (
              ema7_15m[i - 1] > ema99_15m[i - 1] &&
              ema7_15m[i] < ema99_15m[i]
            )
              cross15m = "sell";
            if (
              cross15m &&
              isValidTimeframeCombo({ cross15m, cross1h: cross1h_7_99 })
            ) {
              const candleAfterCross = ema7_15m.length - 1 - i;
              const signalKey = `${symbol}-EMA7/EMA99-${cross15m}-${i}`;
              if (
                candleAfterCross <= 4 &&
                candleAfterCross >= 0 &&
                isValidSignal({
                  currClose: currClose,
                  emaShort: ema7_15m[ema7_15m.length - 1],
                  emaLong: ema99_15m[ema99_15m.length - 1],
                  volume: volume15m,
                  rsi: rsi15m,
                  curvatureShort: curvatureEma7,
                  curvatureLong: curvatureEma99,
                }) &&
                !sentSignals.has(signalKey)
              ) {
                sentSignals.add(signalKey);
                // Ambil ratio long/short
                let longShortRatioText = "";
                try {
                  const ratioRes = await axios.get(
                    "https://fapi.binance.com/futures/data/globalLongShortAccountRatio",
                    { params: { symbol, period: "15m", limit: 1 } }
                  );
                  if (ratioRes.data && ratioRes.data.length > 0) {
                    const ratio = ratioRes.data[0];
                    longShortRatioText =
                      "Long/Short Ratio: " +
                      Number(ratio.longShortRatio).toFixed(2) +
                      " (Long: " +
                      Number(ratio.longAccount).toFixed(0) +
                      ", Short: " +
                      Number(ratio.shortAccount).toFixed(0) +
                      ")";
                  }
                } catch (err) {
                  longShortRatioText = "Long/Short Ratio: -";
                }
                let msg =
                  (cross15m === "buy" ? "BUY " : "SELL ") +
                  "EMA7/EMA99\nPair: " +
                  symbol +
                  "\nTimeframe: 15m\nHarga: " +
                  currClose +
                  "\nEMA7: " +
                  ema7_15m[ema7_15m.length - 1].toFixed(4) +
                  " | EMA99: " +
                  ema99_15m[ema99_15m.length - 1].toFixed(4) +
                  "\nVolume: " +
                  volume15m.toFixed(2) +
                  "\nRSI: " +
                  (rsi15m !== undefined ? rsi15m.toFixed(2) : "-") +
                  "\nKelengkungan EMA7: " +
                  curvatureEma7 +
                  "\nKelengkungan EMA99: " +
                  curvatureEma99 +
                  "\nCandle setelah cross: " +
                  candleAfterCross +
                  "\n" +
                  longShortRatioText +
                  "\nRekomendasi Entry: " +
                  (candleAfterCross <= 2
                    ? "Segera entry di harga saat ini"
                    : "Sudah terlewat beberapa candle, jika kamu yakin entry ya gpp sih..") +
                  "\nHarga entry terbaik: " +
                  currClose;
                await sendTelegramMessage(msg);
              }
            }
          }
          // --- Deteksi dan push crossing EMA25/EMA99 ---
          for (let i = ema25_15m.length - 10; i < ema25_15m.length - 1; i++) {
            let cross15m = null;
            if (
              ema25_15m[i - 1] < ema99_15m[i - 1] &&
              ema25_15m[i] > ema99_15m[i]
            )
              cross15m = "buy";
            if (
              ema25_15m[i - 1] > ema99_15m[i - 1] &&
              ema25_15m[i] < ema99_15m[i]
            )
              cross15m = "sell";
            if (
              cross15m &&
              isValidTimeframeCombo({ cross15m, cross1h: cross1h_25_99 })
            ) {
              const candleAfterCross = ema25_15m.length - 1 - i;
              const signalKey = `${symbol}-EMA25/EMA99-${cross15m}-${i}`;
              if (
                candleAfterCross <= 4 &&
                candleAfterCross >= 0 &&
                isValidSignal({
                  currClose: currClose,
                  emaShort: ema25_15m[ema25_15m.length - 1],
                  emaLong: ema99_15m[ema99_15m.length - 1],
                  volume: volume15m,
                  rsi: rsi15m,
                  curvatureShort: curvatureEma25,
                  curvatureLong: curvatureEma99,
                }) &&
                !sentSignals.has(signalKey)
              ) {
                sentSignals.add(signalKey);
                // Ambil ratio long/short
                let longShortRatioText = "";
                try {
                  const ratioRes = await axios.get(
                    "https://fapi.binance.com/futures/data/globalLongShortAccountRatio",
                    { params: { symbol, period: "15m", limit: 1 } }
                  );
                  if (ratioRes.data && ratioRes.data.length > 0) {
                    const ratio = ratioRes.data[0];
                    longShortRatioText =
                      "Long/Short Ratio: " +
                      Number(ratio.longShortRatio).toFixed(2) +
                      " (Long: " +
                      Number(ratio.longAccount).toFixed(0) +
                      ", Short: " +
                      Number(ratio.shortAccount).toFixed(0) +
                      ")";
                  }
                } catch (err) {
                  longShortRatioText = "Long/Short Ratio: -";
                }
                let msg =
                  (cross15m === "buy" ? "BUY " : "SELL ") +
                  "EMA25/EMA99\nPair: " +
                  symbol +
                  "\nTimeframe: 15m\nHarga: " +
                  currClose +
                  "\nEMA25: " +
                  ema25_15m[ema25_15m.length - 1].toFixed(4) +
                  " | EMA99: " +
                  ema99_15m[ema99_15m.length - 1].toFixed(4) +
                  "\nVolume: " +
                  volume15m.toFixed(2) +
                  "\nRSI: " +
                  (rsi15m !== undefined ? rsi15m.toFixed(2) : "-") +
                  "\nKelengkungan EMA25: " +
                  curvatureEma25 +
                  "\nKelengkungan EMA99: " +
                  curvatureEma99 +
                  "\nCandle setelah cross: " +
                  candleAfterCross +
                  "\n" +
                  longShortRatioText +
                  "\nRekomendasi Entry: " +
                  (candleAfterCross <= 2
                    ? "Segera entry di harga saat ini"
                    : "Sudah terlewat beberapa candle, jika kamu yakin entry ya gpp sih..") +
                  "\nHarga entry terbaik: " +
                  currClose;
                await sendTelegramMessage(msg);
              }
            }
          }
        } catch (err) {
          console.error(`Error pair ${symbol}:`, err);
        }
      })
    );
    res.status(200).json({ success: true, status: "running" });
    return;
  }
  if (!req.query.action && !req.query.test) {
    return res.status(200).json({
      success: true,
      message: "API aktif, tambahkan query action/test.",
    });
  }
  // Selalu kembalikan status 200 agar frontend tidak error
  return res.status(200).json({
    success: false,
    error: "Endpoint tidak ditemukan. Tambahkan query action/test.",
  });
}

// Fungsi validasi sinyal
function isValidSignal({
  currClose,
  emaShort,
  emaLong,
  volume,
  rsi,
  curvatureShort,
  curvatureLong,
}: {
  currClose: number;
  emaShort: number;
  emaLong: number;
  volume: number;
  rsi: number;
  curvatureShort: string | null;
  curvatureLong: string | null;
}) {
  if (
    currClose === undefined ||
    isNaN(currClose) ||
    currClose <= 0 ||
    emaShort === undefined ||
    isNaN(emaShort) ||
    emaShort <= 0 ||
    emaLong === undefined ||
    isNaN(emaLong) ||
    emaLong <= 0 ||
    volume === undefined ||
    isNaN(volume) ||
    volume <= 0 ||
    rsi === undefined ||
    isNaN(rsi) ||
    rsi < 0 ||
    rsi > 100 ||
    !curvatureShort ||
    !curvatureLong
  )
    return false;
  return true;
}

// Fungsi validasi kombinasi antar timeframe
function isValidTimeframeCombo({ cross15m, cross1h }) {
  // Hanya kirim sinyal jika cross di 15m dan 1h sama (BUY/SELL)
  return cross15m === cross1h && (cross15m === "buy" || cross15m === "sell");
}
