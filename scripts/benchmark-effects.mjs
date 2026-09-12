import { createCanvas } from '@napi-rs/canvas';

const width = 2480;
const height = 3508;

function fixture() {
  const source = createCanvas(width, height);
  const mask = createCanvas(width, height);
  const sourceCtx = source.getContext('2d');
  const maskCtx = mask.getContext('2d');
  sourceCtx.fillStyle = '#d33';
  sourceCtx.fillRect(0, 0, width, height);
  maskCtx.fillStyle = 'rgba(0,0,0,.7)';
  maskCtx.fillRect(0, 0, width * .7, height);
  return { source, mask };
}

function cpuClip(source, mask) {
  const ctx = source.getContext('2d');
  const image = ctx.getImageData(0, 0, width, height);
  const alpha = mask.getContext('2d').getImageData(0, 0, width, height).data;
  const strength = 1;
  for (let i = 3; i < image.data.length; i += 4) {
    const factor = 1 - strength * (1 - alpha[i] / 255);
    image.data[i] = Math.round(image.data[i] * factor);
  }
  ctx.putImageData(image, 0, 0);
}

function canvasClip(source, mask) {
  const ctx = source.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(fn) {
  const times = [];
  for (let i = 0; i < 7; i++) {
    const { source, mask } = fixture();
    const start = performance.now();
    fn(source, mask);
    times.push(performance.now() - start);
  }
  return median(times);
}

const cpu = measure(cpuClip);
const native = measure(canvasClip);
console.log(`A4/300ppi clip: CPU ${cpu.toFixed(1)}ms, Canvas ${native.toFixed(1)}ms, ${(cpu / native).toFixed(1)}x faster`);
