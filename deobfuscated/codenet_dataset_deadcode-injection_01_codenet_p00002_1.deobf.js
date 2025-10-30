const fs = require('fs');

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function (chunk) {
    const nums = chunk.trim().split('\n');

    function digit(e) {
        const [a, b] = e.split(' ');
        const sum = parseInt(a) + parseInt(b);
        return sum.toString().length;
    }

    console.log(nums.map(digit).join('\n'));
});
