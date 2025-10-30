const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'utf8');
const string = input.trim();

console.log(reverse(string));

function reverse(s) {
  return s.split('').reverse().join('');
}
