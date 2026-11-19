function qrCodeSvg(value) {
  const version = 5;
  const size = 17 + version * 4;
  const dataCodewords = 108;
  const errorCodewords = 26;
  const modules = Array.from({ length: size }, () => Array(size).fill(null));

  function set(x, y, valueToSet) {
    if (x >= 0 && y >= 0 && x < size && y < size) modules[y][x] = valueToSet;
  }

  function finder(left, top) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(left + dx, top + dy, distance !== 2 && distance !== 4);
      }
    }
  }

  function alignment(centerX, centerY) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function multiply(a, b) {
    let result = 0;
    for (let i = 7; i >= 0; i--) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      if ((b >>> i) & 1) result ^= a;
    }
    return result;
  }

  function generatorPolynomial(degree) {
    let polynomial = [1];
    let root = 1;
    for (let i = 0; i < degree; i++) {
      const next = Array(polynomial.length + 1).fill(0);
      for (let j = 0; j < polynomial.length; j++) {
        next[j] ^= polynomial[j];
        next[j + 1] ^= multiply(polynomial[j], root);
      }
      polynomial = next;
      root = multiply(root, 2);
    }
    return polynomial;
  }

  function codewords(bytes) {
    const work = bytes.concat(Array(errorCodewords).fill(0));
    const generator = generatorPolynomial(errorCodewords);
    for (let i = 0; i < bytes.length; i++) {
      const factor = work[i];
      if (!factor) continue;
      for (let j = 0; j < generator.length; j++) work[i + j] ^= multiply(generator[j], factor);
    }
    return bytes.concat(work.slice(bytes.length));
  }

  function formatBits(mask) {
    const value = (1 << 3) | mask;
    let remainder = value << 10;
    for (let bit = 14; bit >= 10; bit--) {
      if ((remainder >>> bit) & 1) remainder ^= 0x537 << (bit - 10);
    }
    return ((value << 10) | remainder) ^ 0x5412;
  }

  function placeFormat(target, mask) {
    const bits = formatBits(mask);
    const first = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];
    const second = [
      ...Array.from({ length: 8 }, (_, i) => [size - 1 - i, 8]),
      ...Array.from({ length: 7 }, (_, i) => [8, size - 7 + i]),
    ];
    for (let i = 0; i < 15; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      target[first[i][1]][first[i][0]] = dark;
      target[second[i][1]][second[i][0]] = dark;
    }
  }

  function maskApplies(mask, x, y) {
    const product = x * y;
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return (product % 2) + (product % 3) === 0;
      case 6: return ((product % 2) + (product % 3)) % 2 === 0;
      default: return ((x + y) % 2 + (product % 3)) % 2 === 0;
    }
  }

  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 106) throw new Error("The controller URL is too long for the local QR code.");

  const bits = [];
  function appendBits(number, count) {
    for (let bit = count - 1; bit >= 0; bit--) bits.push((number >>> bit) & 1);
  }
  appendBits(0b0100, 4);
  appendBits(bytes.length, 8);
  for (const byte of bytes) appendBits(byte, 8);
  for (let i = 0; i < Math.min(4, dataCodewords * 8 - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((valueSoFar, bit) => (valueSoFar << 1) | bit, 0));
  }
  for (let pad = 0; data.length < dataCodewords; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);
  const allCodewords = codewords(data);
  const dataBits = allCodewords.flatMap((byte) => Array.from({ length: 8 }, (_, bit) => (byte >>> (7 - bit)) & 1));

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  alignment(30, 30);
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] === null) set(i, 6, i % 2 === 0);
    if (modules[i][6] === null) set(6, i, i % 2 === 0);
  }
  set(8, 4 * version + 9, true);
  for (let i = 0; i < 15; i++) {
    const first = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]][i];
    const second = i < 8 ? [size - 1 - i, 8] : [8, size - 7 + i - 8];
    set(first[0], first[1], false);
    set(second[0], second[1], false);
  }

  const candidates = [];
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => row.slice());
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let step = 0; step < size; step++) {
        const y = upward ? size - 1 - step : step;
        for (let offset = 0; offset < 2; offset++) {
          const x = right - offset;
          if (candidate[y][x] !== null) continue;
          const sourceBit = dataBits[bitIndex++] || 0;
          candidate[y][x] = Boolean(sourceBit) !== maskApplies(mask, x, y);
        }
      }
      upward = !upward;
    }
    placeFormat(candidate, mask);
    let penalty = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < size - 1 && y < size - 1 && candidate[y][x] === candidate[y][x + 1] && candidate[y][x] === candidate[y + 1][x] && candidate[y][x] === candidate[y + 1][x + 1]) penalty += 3;
      }
    }
    for (const line of [...candidate, ...candidate[0].map((_, x) => candidate.map((row) => row[x]))]) {
      let runColor = line[0];
      let runLength = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === runColor) runLength++;
        else {
          if (runLength >= 5) penalty += runLength - 2;
          runColor = line[i];
          runLength = 1;
        }
      }
      if (runLength >= 5) penalty += runLength - 2;
    }
    const darkCount = candidate.flat().filter(Boolean).length;
    penalty += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10;
    candidates.push({ modules: candidate, penalty });
  }

  const matrix = candidates.reduce((best, candidate) => candidate.penalty < best.penalty ? candidate : best).modules;
  const pathData = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) pathData.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }
  }
  const extent = size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" role="img" aria-label="QR code para abrir o controle remoto"><rect width="${extent}" height="${extent}" rx="2" fill="#fff"/><path d="${pathData.join("")}" fill="#101321"/></svg>`;
}
