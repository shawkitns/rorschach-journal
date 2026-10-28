// Make a print-ready QR code for the sign.
//   npm install
//   npm run qr -- https://your-site.vercel.app
// Writes qr-code.svg (best for printing at any size) and qr-code.png.
import QRCode from 'qrcode';

const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) {
  console.error('Usage: npm run qr -- https://your-site.vercel.app');
  process.exit(1);
}

// High error correction so it still scans when the sign gets bent, wet or creased.
const opts = { errorCorrectionLevel: 'H', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
await QRCode.toFile('qr-code.svg', url, { ...opts, type: 'svg' });
await QRCode.toFile('qr-code.png', url, { ...opts, width: 2000 });
console.log(`Saved qr-code.svg and qr-code.png for ${url}`);
console.log('Print it at least 15 cm (6 in) wide so people can scan it from a few steps away.');
