const fs = require('fs');

const input = fs.readFileSync('/dev/stdin', 'ascii').trim().split('\n');

input.forEach(line => {
    const [a, b] = line.split(' ').map(Number);
    console.log(`${gcd(a, b)} ${lcm(a, b)}`);
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
