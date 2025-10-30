process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(chunk) {
    const nums = chunk.trim().split('\n');

    function digit(line) {
        const parts = line.split(' ');
        const sum = parseInt(parts[0]) + parseInt(parts[1]);
        return sum.toString().length;
    }

    console.log(nums.map(digit).join('\n'));
});
