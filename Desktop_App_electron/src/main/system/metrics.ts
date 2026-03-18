import * as os from 'os';
import * as fs from 'fs';

// ── CPU usage (1-second sample) ───────────────────────────
function cpuSample(): { idle: number; total: number }[] {
  return os.cpus().map(cpu => {
    const times = cpu.times;
    const total = Object.values(times).reduce((a, b) => a + b, 0);
    return { idle: times.idle, total };
  });
}

export function getCpuUsage(): Promise<number> {
  return new Promise(resolve => {
    const start = cpuSample();
    setTimeout(() => {
      const end = cpuSample();
      let idleDiff = 0, totalDiff = 0;
      for (let i = 0; i < start.length; i++) {
        idleDiff += end[i].idle - start[i].idle;
        totalDiff += end[i].total - start[i].total;
      }
      const usage = totalDiff === 0 ? 0 : (1 - idleDiff / totalDiff) * 100;
      resolve(Math.round(usage * 10) / 10);
    }, 1000);
  });
}

// ── Memory usage % ────────────────────────────────────────
export function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100 * 10) / 10;
}

// ── Device info ───────────────────────────────────────────
export interface DeviceInfo {
  device_id: string;
  device_name: string;
  os: string;
  cpu: string;
  ram: string;
  storage_total: number;
  storage_free: number;
}

function getStorageInfo(): { total: number; free: number } {
  try {
    // Works on Linux/Mac
    const stat = fs.statfsSync('/');
    const total = Math.floor((stat.blocks * stat.bsize) / (1024 * 1024 * 1024));
    const free = Math.floor((stat.bfree * stat.bsize) / (1024 * 1024 * 1024));
    return { total, free };
  } catch {
    return { total: 0, free: 0 };
  }
}

function getMachineId(): string {
  try {
    // Linux
    if (process.platform === 'linux') {
      const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (id) return id;
    }
    // macOS
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice').toString();
      const match = out.match(/IOPlatformUUID.*"(.+)"/);
      if (match) return match[1];
    }
    // Windows
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      const out = execSync('wmic csproduct get UUID').toString();
      const lines = out.trim().split('\n');
      if (lines[1]) return lines[1].trim();
    }
  } catch {/* fallback */}
  return os.hostname() + '_' + os.cpus()[0]?.model.replace(/\s/g, '_');
}

export function getDeviceInfo(): DeviceInfo {
  const storage = getStorageInfo();
  const totalRamGB = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
  return {
    device_id: getMachineId(),
    device_name: os.hostname(),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: `${os.cpus()[0]?.model || 'Unknown'} × ${os.cpus().length}`,
    ram: `${totalRamGB} GB`,
    storage_total: storage.total,
    storage_free: storage.free,
  };
}
