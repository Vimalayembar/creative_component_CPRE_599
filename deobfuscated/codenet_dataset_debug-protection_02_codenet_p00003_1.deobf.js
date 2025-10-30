// deobfuscated.js
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
  const lines = chunk.toString().trim().split('\n');
  lines.shift(); // drop first line (usually test count)

  for (const line of lines) {
    if (!line.trim()) continue;
    const nums = line.split(' ').map(Number);
    nums.sort((a, b) => b - a); // descending

    const [a, b, c] = nums;
    const left = a * a;
    const right = b * b + c * c;

    console.log(left === right ? 'YES' : 'NO');
  }
});
