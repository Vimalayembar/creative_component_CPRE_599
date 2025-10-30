const fs = require('fs');

let input = '';

// Read from stdin
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
});

process.stdin.on('end', () => {
    main();
});

function main() {
    let debt = 100000; // 0x186a0 in hex is 100000 decimal
    const months = parseInt(input.trim(), 10);

    for (let i = 0; i < months; i++) {
        // Increase debt by 5% and round up to nearest 1000
        debt = Math.ceil(debt * 1.05 / 1000) * 1000;
    }

    console.log(debt);
}
