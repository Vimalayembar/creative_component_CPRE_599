// deobfuscated.js
const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8').trim();
console.log(reverse(input));

function reverse(s) {
  return s.split('').reverse().join('');
}
