const fs = require('fs');

const config = { stdin: '/dev/stdin', newline: '\n' };

fs.readFileSync(config.stdin, 'ascii')
  .trim()
  .split(config.newline)
  .forEach(function(line) {
    const [a, b] = line.split(' ').map(Number);
    console.log('%d %d', gcd(a, b), lcm(a, b));
  });

function gcd(a, b) {
  while (a !== b) {
    if (a < b) {
      [a, b] = [b, a];
    }
    if (a % b === 0) return b;
    a -= b;
  }
  return a;
}

function lcm(a, b) {
  const g = gcd(a, b);
  return g * (a / g) * (b / g);
}
