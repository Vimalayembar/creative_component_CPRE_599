process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const input = chunk.toString();
    const lines = input.split('\n');
    lines.shift(); // remove first line if it's the number of test cases

    for (const line of lines) {
        const nums = line.split(' ').map(Number);
        nums.sort((a, b) => b - a); // sort in descending order

        const [a, b, c] = nums;
        const left = a * a;
        const right = b * b + c * c;

        if (left === right) {
            console.log('YES');
        } else {
            console.log('NO');
        }
    }
});
