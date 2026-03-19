const fs = require('fs');

const EV_KEY   = 1;
const EV_REL   = 2;
const EV_ABS   = 3;
const KEY_DOWN = 1;
const KEY_REPEAT = 2;

const LINUX_MODIFIER_CODES = new Set([
  42, 54, 29, 97, 56, 100, 125, 126, 58, 15, 69, 70, 119,
]);

const MOUSE_BTN_LEFT   = 272;
const MOUSE_BTN_RIGHT  = 273;
const MOUSE_BTN_MIDDLE = 274;

const EVENT_SIZE = 24;

// ── Linux keycode to character mapping ───────────────────
const KEYCODE_MAP = {
  2:'1', 3:'2', 4:'3', 5:'4', 6:'5', 7:'6', 8:'7', 9:'8', 10:'9', 11:'0',
  12:'-', 13:'=', 14:'[BACKSPACE]',
  16:'q', 17:'w', 18:'e', 19:'r', 20:'t', 21:'y', 22:'u', 23:'i', 24:'o', 25:'p',
  26:'[', 27:']', 28:'[ENTER]',
  30:'a', 31:'s', 32:'d', 33:'f', 34:'g', 35:'h', 36:'j', 37:'k', 38:'l',
  39:';', 40:"'", 41:'`',
  43:'\\',
  44:'z', 45:'x', 46:'c', 47:'v', 48:'b', 49:'n', 50:'m',
  51:',', 52:'.', 53:'/',
  57:'[SPACE]',
  59:'[F1]', 60:'[F2]', 61:'[F3]', 62:'[F4]', 63:'[F5]',
  64:'[F6]', 65:'[F7]', 66:'[F8]', 67:'[F9]', 68:'[F10]',
  71:'[NUM7]', 72:'[NUM8]', 73:'[NUM9]',
  74:'-', 75:'[NUM4]', 76:'[NUM5]', 77:'[NUM6]',
  78:'+', 79:'[NUM1]', 80:'[NUM2]', 81:'[NUM3]',
  82:'[NUM0]', 83:'[NUM.]',
  87:'[F11]', 88:'[F12]',
  96:'[NUM_ENTER]', 98:'[NUM/]',
  102:'[HOME]', 103:'[UP]', 104:'[PGUP]',
  105:'[LEFT]', 106:'[RIGHT]',
  107:'[END]', 108:'[DOWN]', 109:'[PGDN]',
  110:'[INS]', 111:'[DEL]',
};

const SHIFT_MAP = {
  2:'!', 3:'@', 4:'#', 5:'$', 6:'%', 7:'^', 8:'&', 9:'*', 10:'(', 11:')',
  12:'_', 13:'+',
  16:'Q', 17:'W', 18:'E', 19:'R', 20:'T', 21:'Y', 22:'U', 23:'I', 24:'O', 25:'P',
  26:'{', 27:'}',
  30:'A', 31:'S', 32:'D', 33:'F', 34:'G', 35:'H', 36:'J', 37:'K', 38:'L',
  39:':', 40:'"', 41:'~',
  43:'|',
  44:'Z', 45:'X', 46:'C', 47:'V', 48:'B', 49:'N', 50:'M',
  51:'<', 52:'>', 53:'?',
};

const devices = process.argv.slice(2);
let keystrokeCount = 0;
let rawBuffer      = '';
let shiftPressed   = false;
let capsLock       = false;

// Flush raw keystrokes every 10s
setInterval(() => {
  const count = keystrokeCount;
  const raw   = rawBuffer;
  if (count > 0 || raw.length > 0) {
    process.send({ type: 'flush', count, raw });
    keystrokeCount = 0;
    rawBuffer      = '';
  }
}, 10_000);

function parseEvent(chunk, offset) {
  const base  = offset + EVENT_SIZE - 8;
  const type  = chunk.readUInt16LE(base);
  const code  = chunk.readUInt16LE(base + 2);
  const value = chunk.readInt32LE(base + 4);
  return { type, code, value };
}

for (const devicePath of devices) {
  try {
    const fd     = fs.openSync(devicePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const buffer = Buffer.alloc(EVENT_SIZE);

    function readNext() {
      fs.read(fd, buffer, 0, EVENT_SIZE, null, (err, bytesRead) => {
        if (err) {
          if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
            setTimeout(readNext, 10);
            return;
          }
          setTimeout(readNext, 500);
          return;
        }

        if (bytesRead === EVENT_SIZE) {
          const { type, code, value } = parseEvent(buffer, 0);

          if (type === EV_KEY) {
            // Track shift state
            if (code === 42 || code === 54) {
              shiftPressed = value === 1 || value === 2;
            }
            // Track caps lock
            if (code === 58 && value === 1) {
              capsLock = !capsLock;
            }

            if (value === KEY_DOWN || value === KEY_REPEAT) {
              // Signal activity
              process.send({ type: 'activity' });

              // Skip mouse buttons
              if (code === MOUSE_BTN_LEFT  ||
                  code === MOUSE_BTN_RIGHT ||
                  code === MOUSE_BTN_MIDDLE) {
                readNext();
                return;
              }

              // Skip pure modifiers for count
              if (LINUX_MODIFIER_CODES.has(code)) {
                readNext();
                return;
              }

              // Count keystroke
              keystrokeCount++;
              process.send({ type: 'keystroke', count: 1 });

              // Map to character
              let char = null;
              if (shiftPressed) {
                char = SHIFT_MAP[code] || KEYCODE_MAP[code] || null;
              } else {
                char = KEYCODE_MAP[code] || null;
                // Apply caps lock for letters
                if (char && char.length === 1 && char.match(/[a-z]/)) {
                  if (capsLock) char = char.toUpperCase();
                }
              }

              if (char) {
                rawBuffer += char;
              }
            }
          }

          // Mouse movement
          if (type === EV_REL || type === EV_ABS) {
            process.send({ type: 'activity' });
          }
        }

        readNext();
      });
    }

    readNext();
    process.stderr.write(`[InputWorker] Opened: ${devicePath}\n`);
  } catch (err) {
    process.stderr.write(`[InputWorker] Cannot open ${devicePath}: ${err.message}\n`);
  }
}

process.on('message', (msg) => {
  if (msg === 'stop') process.exit(0);
});