process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const lines = chunk.toString().split('\n');
    lines.shift(); // remove the first line if it's a count or header

    for (const line of lines) {
        const nums = line.split(' ').map(Number);
        nums.sort((a, b) => b - a); // sort in descending order

        const [num1, num2, num3] = nums;
        const square1 = num1 * num1;
        const sumSquares = num2 * num2 + num3 * num3;

        if (square1 === sumSquares) {
            console.log('YES');
        } else {
            console.log('NO');
        }
    }
});
