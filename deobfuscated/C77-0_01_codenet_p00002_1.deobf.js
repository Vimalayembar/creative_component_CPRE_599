process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(input) {
    let lines = input.trim().split('\n');
    
    function processLine(line) {
        let parts = line.split(' ');
        let sum = parseInt(parts[0]) + parseInt(parts[1]);
        return sum.toString().length;
    }

    console.log(lines.map(processLine).join('\n'));
});
