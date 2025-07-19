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
      let volume15m = null;
      let rsi15m = null;
      // Ambil data 15m
      try {
        const klines15m = await axios.get(
          "https://api.binance.com/apiapaka/v3/klines",
          { params: { symbol, interval: "15m", limit: 120 } }
        );
        const closes15m = klines15m.data.map((k: any) => parseFloat(k[4]));
        const volumes15m = klines15m.data.map((k: any) => parseFloat(k[5]));
        volume15m = volumes15m[volumes15m.length - 1];
        const currClose = closes15m[closes15m.length - 1];
        // Hitung RSI
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
        rsi15m = calculateRSI(closes15m, 14);
        const ema7_15m = calculateEMA(closes15m, 7);
        const ema25_15m = calculateEMA(closes15m, 25);
        const ema99_15m = calculateEMA(closes15m, 99);
        // Deteksi kelengkungan EMA7
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
          const dist799 = Math.abs(currEma7 - currEma99);
          const dist725 = Math.abs(currEma7 - currEma25);
          const percent725 = ((currEma7 - currEma25) / currClose) * 100;
          const tpBuy725 = currClose + Math.abs(currEma7 - currEma25) * 2;
          const tpSell725 = currClose - Math.abs(currEma7 - currEma25) * 2;
          const percentProfitBuy725 =
            ((tpBuy725 - currClose) / currClose) * 100;
          const percentProfitSell725 =
            ((currClose - tpSell725) / currClose) * 100;

          // Deteksi index candle cross EMA7/99
          let crossIndex = null;
          for (let i = ema7_15m.length - 10; i < ema7_15m.length - 1; i++) {
            if (
              ema7_15m[i - 1] < ema99_15m[i - 1] &&
              ema7_15m[i] > ema99_15m[i]
            ) {
              crossIndex = i;
              break;
            }
            if (
              ema7_15m[i - 1] > ema99_15m[i - 1] &&
              ema7_15m[i] < ema99_15m[i]
            ) {
              crossIndex = i;
              break;
            }
          }
          // Deteksi index candle cross EMA7/25
          let crossIndex725 = null;
          for (let i = ema7_15m.length - 10; i < ema7_15m.length - 1; i++) {
            if (
              ema7_15m[i - 1] < ema25_15m[i - 1] &&
              ema7_15m[i] > ema25_15m[i]
            ) {
              crossIndex725 = i;
              break;
            }
            if (
              ema7_15m[i - 1] > ema25_15m[i - 1] &&
              ema7_15m[i] < ema25_15m[i]
            ) {
              crossIndex725 = i;
              break;
            }
          }

          // Cross up/down EMA7/99
          if (crossIndex !== null && ema7_15m.length - 1 - crossIndex <= 2) {
            if (prevEma7 < prevEma99 && currEma7 > currEma99) {
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
                volume: volume15m,
                rsi: rsi15m,
                curvature: curvatureEma7,
                crossDistance: Math.abs(currClose - currEma99),
                candleAfterCross: ema7_15m.length - 1 - crossIndex,
                crossType: "ema7-ema99",
              };
            } else if (prevEma7 > prevEma99 && currEma7 < currEma99) {
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
                volume: volume15m,
                rsi: rsi15m,
                curvature: curvatureEma7,
                crossDistance: Math.abs(currClose - currEma99),
                candleAfterCross: ema7_15m.length - 1 - crossIndex,
                crossType: "ema7-ema99",
              };
            }
          }
          // Cross up/down EMA7/25
          else if (
            crossIndex725 !== null &&
            ema7_15m.length - 1 - crossIndex725 <= 2
          ) {
            if (prevEma7 < prevEma25 && currEma7 > currEma25) {
              tf15m = {
                type: "buy",
                currClose,
                currEma7,
                currEma25,
                currEma99,
                dist725,
                percent725,
                tp: tpBuy725,
                sl: currEma25,
                percentProfit: percentProfitBuy725,
                volume: volume15m,
                rsi: rsi15m,
                curvature: curvatureEma7,
                crossDistance: Math.abs(currClose - currEma25),
                candleAfterCross: ema7_15m.length - 1 - crossIndex725,
                crossType: "ema7-ema25",
              };
            } else if (prevEma7 > prevEma25 && currEma7 < currEma25) {
              tf15m = {
                type: "sell",
                currClose,
                currEma7,
                currEma25,
                currEma99,
                dist725,
                percent725,
                tp: tpSell725,
                sl: currEma25,
                percentProfit: percentProfitSell725,
                volume: volume15m,
                rsi: rsi15m,
                curvature: curvatureEma7,
                crossDistance: Math.abs(currClose - currEma25),
                candleAfterCross: ema7_15m.length - 1 - crossIndex725,
                crossType: "ema7-ema25",
              };
            }
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
        const volumes1h = klines1h.data.map((k: any) => parseFloat(k[5]));
        const volume1h = volumes1h[volumes1h.length - 1];
        // Hitung RSI 1h
        function calculateRSI1h(closes: number[], period: number): number {
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
        const rsi1h = calculateRSI1h(closes1h, 14);
        const ema25_1h = calculateEMA(closes1h, 25);
        const ema99_1h = calculateEMA(closes1h, 99);
        // Deteksi kelengkungan EMA25
        let curvatureEma25 = null;
        if (ema25_1h.length >= 3) {
          const slopePrev =
            ema25_1h[ema25_1h.length - 2] - ema25_1h[ema25_1h.length - 3];
          const slopeCurr =
            ema25_1h[ema25_1h.length - 1] - ema25_1h[ema25_1h.length - 2];
          const deltaSlope = slopeCurr - slopePrev;
          if (deltaSlope > 0.0001) curvatureEma25 = "naik tajam";
          else if (deltaSlope < -0.0001) curvatureEma25 = "turun tajam";
          else curvatureEma25 = "datar";
        }
        const currClose1h = closes1h[closes1h.length - 1];
        const prevEma25_1h = ema25_1h[ema25_1h.length - 2];
        const currEma25_1h = ema25_1h[ema25_1h.length - 1];
        const prevEma99_1h = ema99_1h[ema99_1h.length - 2];
        const currEma99_1h = ema99_1h[ema99_1h.length - 1];
        // Deteksi index candle cross EMA25/99
        let crossIndex1h = null;
        for (let i = ema25_1h.length - 10; i < ema25_1h.length - 1; i++) {
          if (ema25_1h[i - 1] < ema99_1h[i - 1] && ema25_1h[i] > ema99_1h[i]) {
            crossIndex1h = i;
            break;
          }
          if (ema25_1h[i - 1] > ema99_1h[i - 1] && ema25_1h[i] < ema99_1h[i]) {
            crossIndex1h = i;
            break;
          }
        }
        // Cross up EMA25/99
        if (
          prevEma25_1h < prevEma99_1h &&
          currEma25_1h > currEma99_1h &&
          crossIndex1h !== null &&
          ema25_1h.length - 1 - crossIndex1h <= 3 // candle tidak lebih dari 3 setelah cross
        ) {
          tf1h = {
            type: "buy",
            currClose: currClose1h,
            currEma25: currEma25_1h,
            currEma99: currEma99_1h,
            volume: volume1h,
            rsi: rsi1h,
            curvature: curvatureEma25,
            candleAfterCross: ema25_1h.length - 1 - crossIndex1h,
          };
        }
        // Cross down EMA25/99
        else if (
          prevEma25_1h > prevEma99_1h &&
          currEma25_1h < currEma99_1h &&
          crossIndex1h !== null &&
          ema25_1h.length - 1 - crossIndex1h <= 3 // candle tidak lebih dari 3 setelah cross
        ) {
          tf1h = {
            type: "sell",
            currClose: currClose1h,
            currEma25: currEma25_1h,
            currEma99: currEma99_1h,
            volume: volume1h,
            rsi: rsi1h,
            curvature: curvatureEma25,
            candleAfterCross: ema25_1h.length - 1 - crossIndex1h,
          };
        }
        // Jika tidak ada cross valid, null
        else {
          tf1h = null;
        }
      } catch (err: any) {
        tf1h = null;
      }
      // Kirim sinyal hanya jika 15m dan 1h saling mengkonfirmasi
      // --- PUSH SINYAL TF 15M ---
      if (tf15m) {
        let crossText =
          tf15m.crossType === "ema7-ema99" ? "EMA7/EMA99" : "EMA7/EMA25";
        let msgUnified = `${
          tf15m.type === "buy" ? "🚀 BUY SIGNAL" : "🔻 SELL SIGNAL"
        }\nPair: ${symbol}\nTimeframe: 15m\nHarga Terakhir: ${
          tf15m.currClose
        }\nEMA7: ${tf15m.currEma7?.toFixed(
          4
        )} | EMA25: ${tf15m.currEma25?.toFixed(
          4
        )} | EMA99: ${tf15m.currEma99?.toFixed(4)}\nJarak EMA7-${crossText}: ${
          tf15m.crossType === "ema7-ema99"
            ? tf15m.dist799?.toFixed(4) +
              " (" +
              tf15m.percent799?.toFixed(2) +
              "%)"
            : tf15m.dist725?.toFixed(4) +
              " (" +
              tf15m.percent725?.toFixed(2) +
              "%)"
        }\nVolume: ${tf15m.volume?.toFixed(2)}\nRSI: ${tf15m.rsi?.toFixed(
          2
        )}\nKelengkungan EMA7: ${
          tf15m.curvature
        }\nJarak Harga ke ${crossText}: ${
          tf15m.crossType === "ema7-ema99"
            ? tf15m.crossDistance?.toFixed(6)
            : Math.abs(tf15m.currClose - tf15m.currEma25)?.toFixed(6)
        }\nTP: ${tf15m.tp?.toFixed(4)} | SL: ${tf15m.sl?.toFixed(
          4
        )}\nProfit: ${tf15m.percentProfit?.toFixed(2)}%`;
        await sendTelegramMessage(msgUnified);
      }
      // --- PUSH SINYAL TF 1H ---
      if (tf1h) {
        let msgUnified = `${
          tf1h.type === "buy" ? "🚀 BUY SIGNAL" : "🔻 SELL SIGNAL"
        }\nPair: ${symbol}\nTimeframe: 1h\nHarga Terakhir: ${
          tf1h.currClose
        }\nEMA25: ${tf1h.currEma25?.toFixed(
          4
        )} | EMA99: ${tf1h.currEma99?.toFixed(
          4
        )}\nVolume: ${tf1h.volume?.toFixed(2)}\nRSI: ${tf1h.rsi?.toFixed(
          2
        )}\nKelengkungan EMA25: ${tf1h.curvature}\nCandle setelah cross: ${
          tf1h.candleAfterCross
        }\nTrend 1h: ${
          tf1h.type === "buy" ? "UP (EMA25 > EMA99)" : "DOWN (EMA25 < EMA99)"
        }`;
        await sendTelegramMessage(msgUnified);
      }
      // --- PUSH SINYAL GABUNGAN (MULTI-TF KONFIRMASI) ---
      if (tf15m && tf1h) {
        // Pastikan sinyal gabungan hanya dikirim jika cross TF 15m terjadi pada maksimal 2 candle setelah cross
        if (
          (tf15m.crossType === "ema7-ema99" && tf15m.candleAfterCross <= 2) ||
          (tf15m.crossType === "ema7-ema25" && tf15m.candleAfterCross <= 2)
        ) {
          let msgUnified = `${
            tf15m.type === "buy" ? "🚀 BUY SIGNAL" : "🔻 SELL SIGNAL"
          }\nPair: ${symbol}\nTimeframe: 15m (Entry), 1h (Trend)\nHarga Terakhir: ${
            tf15m.currClose
          }\nEMA7: ${tf15m.currEma7.toFixed(
            4
          )} | EMA25: ${tf15m.currEma25.toFixed(
            4
          )} | EMA99: ${tf15m.currEma99.toFixed(
            4
          )}\nJarak EMA7-EMA99: ${tf15m.dist799.toFixed(
            4
          )} (${tf15m.percent799.toFixed(2)}%)\nVolume: ${tf15m.volume?.toFixed(
            2
          )}\nRSI: ${tf15m.rsi?.toFixed(2)}\nKelengkungan EMA7: ${
            tf15m.curvature
          }\nJarak Harga ke EMA99: ${tf15m.crossDistance?.toFixed(
            6
          )}\nTrend 1h: ${
            tf1h.type === "buy" ? "UP (EMA25 > EMA99)" : "DOWN (EMA25 < EMA99)"
          }`;
          await sendTelegramMessage(msgUnified);
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
