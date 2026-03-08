/**
 * Uptime Kuma JWT Token Alma Araci
 *
 * Kullanim:
 *   node scripts/get-jwt-token.js <username> <password> [2fa-token]
 *
 * Cikan token'i .env dosyasina UPTIME_KUMA_TOKEN olarak ekle.
 * Token expire olmuyor — bir kez alman yeterli.
 */

import { io } from 'socket.io-client';
import { loadEnv } from '../src/env.js';

loadEnv();

if (!process.env.UPTIME_KUMA_URL) {
  console.error('HATA: UPTIME_KUMA_URL ayarli degil — .env dosyasina ekleyin');
  process.exit(1);
}
const url = process.env.UPTIME_KUMA_URL.replace(/\/$/, '');
const username = process.argv[2] || process.env.UPTIME_KUMA_USERNAME;
const password = process.argv[3] || process.env.UPTIME_KUMA_PASSWORD;
const twoFAToken = process.argv[4];

if (!username || !password) {
  console.error('Kullanim: node scripts/get-jwt-token.js <username> <password>');
  console.error('  veya .env\'e UPTIME_KUMA_USERNAME ve UPTIME_KUMA_PASSWORD ekle');
  process.exit(1);
}

function printToken(token) {
  console.log('\nGiris basarili!\n');
  console.log('=== JWT TOKEN ===');
  console.log(token);
  console.log('=================\n');
  console.log('.env dosyaniza su satiri ekleyin:');
  console.log(`UPTIME_KUMA_TOKEN=${token}`);
  console.log('\nBu token expire olmaz, bir kez almaniz yeterli.');
}

console.log(`Uptime Kuma'ya baglaniliyor: ${url}`);

const CONNECT_TIMEOUT = 15_000;

const socket = io(url, {
  transports: ['websocket'],
  timeout: CONNECT_TIMEOUT,
  reconnection: false,
});

const timer = setTimeout(() => {
  console.error(`Zaman asimi — baglanti ${CONNECT_TIMEOUT / 1000} saniyede kurulamadi`);
  socket.disconnect();
  process.exit(1);
}, CONNECT_TIMEOUT);

socket.on('connect', () => {
  console.log('Baglandi, giris yapiliyor...');

  socket.emit('login', { username, password, token: '' }, (res) => {
    clearTimeout(timer);

    if (!res.ok) {
      console.error('Giris basarisiz:', res.msg);
      socket.disconnect();
      process.exit(1);
    }

    if (res.tokenRequired) {
      if (!twoFAToken) {
        console.error('2FA aktif — lutfen 2FA token\'ini de girin:');
        console.error('  node scripts/get-jwt-token.js <username> <password> <2fa-token>');
        socket.disconnect();
        process.exit(1);
      }

      console.log('2FA kodu gonderiliyor...');
      socket.emit('twoFACheck', twoFAToken, (r) => {
        if (!r.ok) {
          console.error('2FA dogrulama basarisiz:', r.msg);
          socket.disconnect();
          process.exit(1);
        }

        printToken(r.token);
        socket.disconnect();
        process.exit(0);
      });
      return;
    }

    printToken(res.token);
    socket.disconnect();
    process.exit(0);
  });
});

socket.on('connect_error', (err) => {
  clearTimeout(timer);
  console.error('Baglanti hatasi:', err.message);
  process.exit(1);
});
