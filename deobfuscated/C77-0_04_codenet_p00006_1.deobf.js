const fs = require('fs');
const input = fs.readFileSync('/dev/stdin', 'utf8');
const string = input.trim();
console.log(reverse(string));

function reverse(str) {
    return str.split('').reverse().join('');
}
