process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const nums = chunk.trim().split('\n');

    function digitSumLength(line) {
        const [a, b] = line.split(' ').map(Number);
        const sum = a + b;
        return sum.toString().length;
    }

    const result = nums.map(digitSumLength).join('\n');
    console.log(result);
});
