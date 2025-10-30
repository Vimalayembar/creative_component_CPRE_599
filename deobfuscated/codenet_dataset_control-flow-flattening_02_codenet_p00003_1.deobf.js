process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const lines = chunk.toString().trim().split('\n');
    lines.shift(); // remove first line if it's a count

    lines.forEach(line => {
        let nums = line.split(' ').map(Number);
        // Sort descending
        nums.sort((a, b) => b - a);

        const num1 = nums[0] * nums[0];
        const num2 = nums[1] * nums[1];
        const num3 = nums[2] * nums[2];

        if (num1 === num2 + num3) {
            console.log('YES');
        } else {
            console.log('NO');
        }
    });
});
