const fs = require('fs');
const config = {
    stdin: '/dev/stdin',
    newline: '\n'
};

const input = fs.readFileSync(config.stdin, 'ascii')
                .trim()
                .split(config.newline);

input.forEach(line => {
    const [a, b] = line.split(' ').map(Number);
    console.log(`${gcd(a, b)} ${lcm(a, b)}`);
});

function gcd(a, b) {
    while (a !== b) {
        if (a < b) {
            [a, b] = [b, a]; // swap
        }
        if (a % b === 0) return b;
        a -= b;
    }
    return a;
}

function lcm(a, b) {
    const g = gcd(a, b);
    return (a * b) / g;
}
