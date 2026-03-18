import * as os from 'os';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';

export interface NetworkInfo {
  ip_address: string;
  connection_type: string;
  ssid: string;
  mac_address: string;
}

export interface NetworkSpeed {
  download: number;  // Mbps
  upload: number;    // Mbps
  ping: number;      // ms
}

// ── Get local IP and MAC ──────────────────────────────────
export function getNetworkInfo(): NetworkInfo {
  const interfaces = os.networkInterfaces();
  let ip = '127.0.0.1';
  let mac = '00:00:00:00:00:00';
  let connectionType = 'unknown';

  for (const [name, ifaces] of Object.entries(interfaces)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.internal) continue;
      if (iface.family === 'IPv4') {
        ip = iface.address;
        mac = iface.mac;
        if (/^(eth|en[0-9]|ens|enp)/.test(name.toLowerCase())) {
          connectionType = 'Ethernet';
        } else if (/^(wlan|wi|wlp)/.test(name.toLowerCase())) {
          connectionType = 'WiFi';
        } else {
          connectionType = name;
        }
        break;
      }
    }
    if (ip !== '127.0.0.1') break;
  }

  // SSID — best effort (platform-specific)
  let ssid = '';
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'darwin') {
      const out = execSync(
        '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I'
      ).toString();
      const match = out.match(/\s+SSID: (.+)/);
      ssid = match ? match[1].trim() : '';
    } else if (process.platform === 'linux') {
      const out = execSync('iwgetid -r 2>/dev/null || echo ""').toString();
      ssid = out.trim();
    } else if (process.platform === 'win32') {
      const out = execSync('netsh wlan show interfaces').toString();
      const match = out.match(/\s+SSID\s+:\s(.+)/);
      ssid = match ? match[1].trim() : '';
    }
  } catch {/* ssid stays empty */}

  return { ip_address: ip, connection_type: connectionType, ssid, mac_address: mac };
}

// ══════════════════════════════════════════════════════════
// ACCURATE SPEED TEST (Ookla-style)
// Uses multiple CDN endpoints + parallel streams for accuracy
// ══════════════════════════════════════════════════════════

// CDN endpoints that serve large files reliably and are distributed globally
// These are public CDN/speed-test servers commonly used for benchmarking
const DOWNLOAD_ENDPOINTS = [
  // Cloudflare speed test (100MB chunks available)
  { host: 'speed.cloudflare.com', path: '/__down?bytes=10000000', useHttps: true },
  // Fast.com (Netflix CDN) - very reliable
  { host: 'api.fast.com', path: '/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=1', useHttps: true },
  // Fallback: Cloudflare 10MB
  { host: 'speed.cloudflare.com', path: '/__down?bytes=5000000', useHttps: true },
];

// Upload test: POST random data to Cloudflare's speed test endpoint
const UPLOAD_ENDPOINT = {
  host: 'speed.cloudflare.com',
  path: '/__up',
  useHttps: true,
};

/**
 * Measure ping to a host using TCP connect time (accurate, no ICMP needed)
 */
function measureTcpPing(host: string, port: number, samples = 5): Promise<number> {
  const pings: number[] = [];

  const doOnePing = (): Promise<number> => new Promise(resolve => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.connect(port, host, () => {
      resolve(Date.now() - start);
      socket.destroy();
    });
    socket.on('error', () => resolve(-1));
    socket.on('timeout', () => { socket.destroy(); resolve(-1); });
  });

  return (async () => {
    for (let i = 0; i < samples; i++) {
      const p = await doOnePing();
      if (p >= 0) pings.push(p);
      // Small gap between ping samples
      if (i < samples - 1) await new Promise(r => setTimeout(r, 100));
    }
    if (pings.length === 0) return 999;
    // Use median to discard outliers
    pings.sort((a, b) => a - b);
    return pings[Math.floor(pings.length / 2)];
  })();
}

/**
 * Download a single stream and measure throughput in Mbps
 */
function downloadStream(host: string, path: string, useHttps: boolean, timeoutMs = 15000): Promise<number> {
  return new Promise(resolve => {
    const lib = useHttps ? https : http;
    const port = useHttps ? 443 : 80;
    let bytes = 0;
    const start = Date.now();

    const options: http.RequestOptions = {
      hostname: host,
      port,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpeedTest/1.0)',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        resolve(0);
        return;
      }
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      res.on('end', () => {
        const elapsed = (Date.now() - start) / 1000;
        if (elapsed < 0.1 || bytes === 0) { resolve(0); return; }
        // Convert bytes to megabits: (bytes * 8) / elapsed / 1_000_000
        const mbps = (bytes * 8) / elapsed / 1_000_000;
        resolve(Math.round(mbps * 100) / 100);
      });
      res.on('error', () => resolve(0));
    });

    req.setTimeout(timeoutMs, () => {
      // On timeout, calculate based on what we've received so far
      req.destroy();
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed > 0.5 && bytes > 100_000) {
        const mbps = (bytes * 8) / elapsed / 1_000_000;
        resolve(Math.round(mbps * 100) / 100);
      } else {
        resolve(0);
      }
    });

    req.on('error', () => resolve(0));
    req.end();
  });
}

/**
 * Upload test: POST a buffer of random data and measure throughput
 */
function uploadStream(sizeBytes: number, timeoutMs = 15000): Promise<number> {
  return new Promise(resolve => {
    // Generate random data buffer to upload
    const data = Buffer.alloc(sizeBytes, 'x');
    const start = Date.now();

    const options: https.RequestOptions = {
      hostname: UPLOAD_ENDPOINT.host,
      port: 443,
      path: UPLOAD_ENDPOINT.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': sizeBytes,
        'User-Agent': 'Mozilla/5.0 (compatible; SpeedTest/1.0)',
        'Cache-Control': 'no-cache',
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      res.resume(); // drain response
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed < 0.1) { resolve(0); return; }
      const mbps = (sizeBytes * 8) / elapsed / 1_000_000;
      resolve(Math.round(mbps * 100) / 100);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed > 0.5) {
        // Estimate based on how much we've sent (approximation)
        const mbps = (sizeBytes * 8) / elapsed / 1_000_000;
        resolve(Math.round(mbps * 100) / 100);
      } else {
        resolve(0);
      }
    });

    req.on('error', () => resolve(0));
    req.write(data);
    req.end();
  });
}

/**
 * Run multiple parallel download streams and sum their throughput.
 * This is how Ookla measures — single-stream tests are limited by
 * TCP window size; parallel streams saturate the connection.
 */
async function measureDownloadParallel(): Promise<number> {
  // Try Cloudflare first with 3 parallel streams of 10MB each
  const PARALLEL_STREAMS = 3;
  const endpoint = DOWNLOAD_ENDPOINTS[0]; // Cloudflare

  try {
    const streams = Array.from({ length: PARALLEL_STREAMS }, () =>
      downloadStream(endpoint.host, endpoint.path, endpoint.useHttps, 12000)
    );
    const results = await Promise.all(streams);
    const valid = results.filter(r => r > 0);

    if (valid.length > 0) {
      // Sum all parallel streams = total bandwidth
      const total = valid.reduce((a, b) => a + b, 0);
      return Math.round(total * 100) / 100;
    }
  } catch { /* fall through */ }

  // Fallback: try single stream from Cloudflare 5MB
  try {
    const ep = DOWNLOAD_ENDPOINTS[2];
    const result = await downloadStream(ep.host, ep.path, ep.useHttps, 10000);
    if (result > 0) return result;
  } catch { /* fall through */ }

  return 0;
}

/**
 * Measure upload speed with parallel streams
 */
async function measureUploadParallel(): Promise<number> {
  const UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB per stream
  const PARALLEL_STREAMS = 2;

  try {
    const streams = Array.from({ length: PARALLEL_STREAMS }, () =>
      uploadStream(UPLOAD_SIZE, 12000)
    );
    const results = await Promise.all(streams);
    const valid = results.filter(r => r > 0);

    if (valid.length > 0) {
      return Math.round(valid.reduce((a, b) => a + b, 0) * 100) / 100;
    }
  } catch { /* fall through */ }

  return 0;
}

/**
 * Full speed test — measures ping, download, upload accurately.
 * Total time: ~20-30 seconds (real measurement takes time)
 */
export async function getNetworkSpeed(): Promise<NetworkSpeed> {
  try {
    // Step 1: Measure latency/ping to Cloudflare (very stable)
    const pingPromise = measureTcpPing('speed.cloudflare.com', 443, 5);

    // Step 2: Run download and upload in sequence (not parallel)
    // Running them together would split bandwidth and give wrong readings
    const [ping, download] = await Promise.all([
      pingPromise,
      measureDownloadParallel(),
    ]);

    // Upload test after download
    const upload = await measureUploadParallel();

    return {
      download: download > 0 ? download : 0,
      upload:   upload  > 0 ? upload  : 0,
      ping:     ping < 999  ? ping    : 0,
    };
  } catch {
    return { download: 0, upload: 0, ping: 0 };
  }
}

// ── Public IP via ipapi ───────────────────────────────────
export interface GeoInfo {
  ip: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  location: string;
}

export function getGeoInfo(): Promise<GeoInfo> {
  return new Promise(resolve => {
    const fallback: GeoInfo = { ip: '', city: '', country: '', latitude: 0, longitude: 0, location: '' };
    const req = http.get('http://ip-api.com/json/?fields=status,city,country,lat,lon,query', (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (j.status === 'success') {
            resolve({
              ip: j.query,
              city: j.city,
              country: j.country,
              latitude: j.lat,
              longitude: j.lon,
              location: `${j.city}, ${j.country}`,
            });
          } else {
            resolve(fallback);
          }
        } catch {
          resolve(fallback);
        }
      });
    });
    req.setTimeout(6000, () => { req.destroy(); resolve(fallback); });
    req.on('error', () => resolve(fallback));
  });
}