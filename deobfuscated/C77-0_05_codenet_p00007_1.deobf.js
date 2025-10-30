let input = '';

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => input += chunk);

process.stdin.on('end', () => {
    let result = 100000;
    for(let i = 0; i < input.trim().length; i++){
        result = Math.ceil(result * 1.05 / 1000) * 1000;
    }
    console.log(result);
});
