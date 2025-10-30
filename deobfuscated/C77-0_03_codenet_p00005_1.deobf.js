// gcd_lcm.js
const fs = require('fs');

// Read input from stdin, split, and parse numbers
const input = fs.readFileSync('/dev/stdin', 'ascii').trim().split(' ');
const a = Number(input[0]);
const b = Number(input[1]);

// Function to compute GCD
function gcd(x, y) {
  while (x !== y) {
    if (x < y) {
      [x, y] = [y, x];
    }
    if (x % y === 0) return y;
    x -= y;
  }
  return x;
}

// Function to compute LCM
function lcm(x, y) {
  const g = gcd(x, y);
  return (x * y) / g;
}

// Print GCD and LCM
console.log('%d %d', gcd(a, b), lcm(a, b));
