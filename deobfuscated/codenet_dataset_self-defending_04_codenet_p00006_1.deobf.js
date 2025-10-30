const fs = require('fs');

// Read input from stdin
const input = fs.readFileSync('/dev/stdin', 'utf8').trim();

// Reverse the string
console.log(reverse(input));

function reverse(s) {
    return s.split('').reverse().join('');
}
