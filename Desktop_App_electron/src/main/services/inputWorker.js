/**
 * inputWorker.js
 * Runs as a child process to read /dev/input devices
 * without blocking the main Electron process.
 */

const fs = require('fs');
const os = require('os');

const EV_KEY   = 1;
const EV_REL   = 2;
const EV_ABS   = 3;
const KEY_DOWN = 1;

const LINUX_MODIFIER_CODES = new Set([
  42, 54, 29, 97, 56, 100, 125, 126, 58, 15, 69, 70, 119,
]);

const MOUSE_BTN_LEFT   = 272;
const MOUSE_BTN_RIGHT  = 273;
const MOUSE_BTN_MIDDLE = 274;

const EVENT_SIZE = 24; // 64-bit Linux

function parseEvent(chunk, offset) {
  const base  = offset + EVENT_SIZE - 8;
  const type  = chunk.readUInt16LE(base);
  const code  = chunk.readUInt16LE(base + 2);
  const value = chunk.readInt32LE(base + 4);
  return { type, code, value };
}

const devices = process.argv.slice(2); // passed from parent
let keystrokeCount = 0;

for (const devicePath of devices) {
  try {
    const fd = fs.openSync(devicePath, 'r');
    const buffer = Buffer.alloc(EVENT_SIZE);

    // Use async read loop for each device
    function readNext() {
      fs.read(fd, buffer, 0, EVENT_SIZE, null, (err, bytesRead) => {
        if (err || bytesRead === 0) {
          setTimeout(readNext, 100);
          return;
        }

        if (bytesRead === EVENT_SIZE) {
          const { type, code, value } = parseEvent(buffer, 0);

          if (type === EV_KEY && value === KEY_DOWN) {
            // Signal activity (mouse or keyboard)
            process.send({ type: 'activity' });

            // Skip mouse buttons
            if (code === MOUSE_BTN_LEFT ||
                code === MOUSE_BTN_RIGHT ||
                code === MOUSE_BTN_MIDDLE) {
              readNext();
              return;
            }

            // Skip modifiers
            if (LINUX_MODIFIER_CODES.has(code)) {
              readNext();
              return;
            }

            // Real keystroke
            keystrokeCount++;
            process.send({ type: 'keystroke', count: keystrokeCount });
          }

          // Mouse movement / scroll
          if (type === EV_REL || type === EV_ABS) {
            process.send({ type: 'activity' });
          }
        }

        readNext();
      });
    }

    readNext();
    console.error(`[InputWorker] Opened: ${devicePath}`);
  } catch (err) {
    console.error(`[InputWorker] Cannot open ${devicePath}:`, err.message);
  }
}

// Flush keystroke count every 10s to parent
setInterval(() => {
  if (keystrokeCount > 0) {
    process.send({ type: 'flush', count: keystrokeCount });
    keystrokeCount = 0;
  }
}, 10_000);

process.on('message', (msg) => {
  if (msg === 'stop') process.exit(0);
});