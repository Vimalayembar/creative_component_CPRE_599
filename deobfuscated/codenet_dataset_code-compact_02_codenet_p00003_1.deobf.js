process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(chunk) {
    const input = chunk.toString();
    const lines = input.split('\n');
    
    // Remove the first line if it contains the number of test cases
    lines.shift();

    for (let line of lines) {
        const nums = line.split(' ').map(Number);

        // Sort in descending order
        nums.sort((a, b) => b - a);

        const num1 = nums[0] * nums[0];
        const num2 = nums[1] * nums[1];
        const num3 = nums[2] * nums[2];
        const sum = num2 + num3;

        if (num1 === sum) {
            console.log('YES');
        } else {
            console.log('NO');
        }
    }
});
