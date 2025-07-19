# Todo List: Bot Telegram EMA Cross Binance (Next.js)

✔️ 1. Inisialisasi project Next.js
✔️ 2. Setup struktur folder dan file utama (frontend & backend)
✔️ 3. Integrasi API Binance (menggunakan backend Next.js API routes)
✔️ 4. Implementasi logika deteksi EMA cross (EMA 7, EMA 25, dan EMA 99) di backend:

- Deteksi sinyal beli: EMA 7 memotong ke atas EMA 25/EMA 99
- Deteksi sinyal jual: EMA 7 memotong ke bawah EMA 25/EMA 99
- Konfirmasi tren kuat: EMA 25 memotong EMA 99
- Kirim notifikasi ke Telegram jika terjadi cross
- Pantau dan deteksi pada timeframe 15 menit dan 1 jam
- Pantau hingga 1000 pair USDT di Binance

✔️ 5. Integrasi bot Telegram di backend (mengirim pesan otomatis)
✔️ 6. Buat halaman frontend untuk monitoring status bot
✔️ 7. Konfigurasi environment variable (API key, token Telegram, dll)

- Simpan token Telegram di file .env
- Simpan chat ID Telegram (misal: 397958967) di file .env
- Format di .env:
  TELEGRAM_BOT_TOKEN=7844167875:AAGO2t5mFI3WP56NCt7OPYYGMtfLtEfDxCg
  TELEGRAM_CHAT_ID=397958967
- Pastikan file .env masuk ke .gitignore
- Pastikan token dan chat ID tidak dibagikan secara publik

8. Testing fitur deteksi dan pengiriman notifikasi
9. Deployment project (opsional)
10. Dokumentasi penggunaan dan setup
