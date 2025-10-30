const fs = require('fs');

// Read input from stdin
const input = fs.readFileSync('/dev/stdin', 'utf8');
const string = input.trim();

// Reverse the string and print it
console.log(reverse(string));

function reverse(s) {
    return s.split('').reverse().join('');
}
