process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const lines = chunk.trim().split('\n');

    function digit(line) {
        const [a, b] = line.split(' ').map(Number);
        const sum = a + b;
        return sum.toString().length;
    }

    console.log(lines.map(digit).join('\n'));
});
