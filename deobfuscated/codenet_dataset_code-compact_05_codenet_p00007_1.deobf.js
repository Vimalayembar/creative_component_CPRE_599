function main() {
  let debt = 100000; // 0x186a0 in hex
  const n = parseInt(input.trim(), 10); // number of iterations

  for (let i = 0; i < n; i++) {
    debt = Math.ceil((debt * 1.05) / 1000) * 1000;
  }

  console.log(debt);
}

let input = '';

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(chunk) {
  input += chunk;
});

process.stdin.on('end', function() {
  main();
});
