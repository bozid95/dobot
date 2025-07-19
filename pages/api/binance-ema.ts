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
              params: { symbol, interval, limit: 120 }, // ambil lebih banyak candle
            }
          );
          const closes = klinesRes.data.map((k: any) => parseFloat(k[4]));
          const volumes = klinesRes.data.map((k: any) => parseFloat(k[5]));
          const ema7 = calculateEMA(closes, 7);
          const ema25 = calculateEMA(closes, 25);
          const ema99 = calculateEMA(closes, 99);

          // Filter volume minimal (misal: 1000, bisa disesuaikan)
          const minVolume = 1000;
          const currVolume = volumes[volumes.length - 1];
          if (currVolume < minVolume) continue;

          // Filter jarak antar EMA (misal: minimal 0.1% dari harga)
          const currClose = closes[closes.length - 1];
          const minDistance = currClose * 0.001;
          const dist725 = Math.abs(
            ema7[ema7.length - 1] - ema25[ema25.length - 1]
          );
          const dist799 = Math.abs(
            ema7[ema7.length - 1] - ema99[ema99.length - 1]
          );
          if (dist725 < minDistance && dist799 < minDistance) continue;

          // Validasi cross hanya jika benar-benar terjadi pada candle terakhir
          const prevEma7 = ema7[ema7.length - 2];
          const prevEma25 = ema25[ema25.length - 2];
          const prevEma99 = ema99[ema99.length - 2];
          const currEma7 = ema7[ema7.length - 1];
          const currEma25 = ema25[ema25.length - 1];
          const currEma99 = ema99[ema99.length - 1];

          // Hitung jarak persentase antar EMA
          const percent725 = ((currEma7 - currEma25) / currClose) * 100;
          const percent799 = ((currEma7 - currEma99) / currClose) * 100;

          // Estimasi Take Profit dan Stop Loss (TP = 2x jarak EMA, SL = EMA panjang)
          const tpBuy725 = currClose + Math.abs(currEma7 - currEma25) * 2;
          const slBuy725 = currEma25;
          const tpSell725 = currClose - Math.abs(currEma7 - currEma25) * 2;
          const slSell725 = currEma25;
          const tpBuy799 = currClose + Math.abs(currEma7 - currEma99) * 2;
          const slBuy799 = currEma99;
          const tpSell799 = currClose - Math.abs(currEma7 - currEma99) * 2;
          const slSell799 = currEma99;

          // Estimasi persentase profit TP
          const percentProfitBuy725 =
            ((tpBuy725 - currClose) / currClose) * 100;
          const percentProfitSell725 =
            ((currClose - tpSell725) / currClose) * 100;
          const percentProfitBuy799 =
            ((tpBuy799 - currClose) / currClose) * 100;
          const percentProfitSell799 =
            ((currClose - tpSell799) / currClose) * 100;

          let message = "";
          // Cross up EMA 7/25
          if (prevEma7 < prevEma25 && currEma7 > currEma25) {
            message += `🚀 BUY SIGNAL\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA7: ${currEma7.toFixed(
              4
            )}\nEMA25: ${currEma25.toFixed(
              4
            )}\nJarak EMA7-EMA25: ${dist725.toFixed(4)} (${percent725.toFixed(
              2
            )}%)\nTP (estimasi): ${tpBuy725.toFixed(
              4
            )} (${percentProfitBuy725.toFixed(
              2
            )}%)\nSL (estimasi): ${slBuy725.toFixed(
              4
            )}\nKeterangan: EMA7 baru saja cross UP EMA25\n\n`;
          }
          // Cross down EMA 7/25
          if (prevEma7 > prevEma25 && currEma7 < currEma25) {
            message += `🔻 SELL SIGNAL\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA7: ${currEma7.toFixed(
              4
            )}\nEMA25: ${currEma25.toFixed(
              4
            )}\nJarak EMA7-EMA25: ${dist725.toFixed(4)} (${percent725.toFixed(
              2
            )}%)\nTP (estimasi): ${tpSell725.toFixed(
              4
            )} (${percentProfitSell725.toFixed(
              2
            )}%)\nSL (estimasi): ${slSell725.toFixed(
              4
            )}\nKeterangan: EMA7 baru saja cross DOWN EMA25\n\n`;
          }
          // Cross up EMA 7/99
          if (prevEma7 < prevEma99 && currEma7 > currEma99) {
            message += `🚀 BUY SIGNAL (EMA99)\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA7: ${currEma7.toFixed(
              4
            )}\nEMA99: ${currEma99.toFixed(
              4
            )}\nJarak EMA7-EMA99: ${dist799.toFixed(4)} (${percent799.toFixed(
              2
            )}%)\nTP (estimasi): ${tpBuy799.toFixed(
              4
            )} (${percentProfitBuy799.toFixed(
              2
            )}%)\nSL (estimasi): ${slBuy799.toFixed(
              4
            )}\nKeterangan: EMA7 baru saja cross UP EMA99\n\n`;
          }
          // Cross down EMA 7/99
          if (prevEma7 > prevEma99 && currEma7 < currEma99) {
            message += `🔻 SELL SIGNAL (EMA99)\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA7: ${currEma7.toFixed(
              4
            )}\nEMA99: ${currEma99.toFixed(
              4
            )}\nJarak EMA7-EMA99: ${dist799.toFixed(4)} (${percent799.toFixed(
              2
            )}%)\nTP (estimasi): ${tpSell799.toFixed(
              4
            )} (${percentProfitSell799.toFixed(
              2
            )}%)\nSL (estimasi): ${slSell799.toFixed(
              4
            )}\nKeterangan: EMA7 baru saja cross DOWN EMA99\n\n`;
          }
          // Trend confirmation EMA 25/99
          if (prevEma25 < prevEma99 && currEma25 > currEma99) {
            message += `📈 TREND CONFIRMATION UP\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA25: ${currEma25.toFixed(
              4
            )}\nEMA99: ${currEma99.toFixed(
              4
            )}\nKeterangan: EMA25 baru saja cross UP EMA99\n\n`;
          }
          if (prevEma25 > prevEma99 && currEma25 < currEma99) {
            message += `📉 TREND CONFIRMATION DOWN\nPair: ${symbol}\nInterval: ${interval}\nHarga Terakhir: ${currClose}\nVolume: ${currVolume}\nEMA25: ${currEma25.toFixed(
              4
            )}\nEMA99: ${currEma99.toFixed(
              4
            )}\nKeterangan: EMA25 baru saja cross DOWN EMA99\n\n`;
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
