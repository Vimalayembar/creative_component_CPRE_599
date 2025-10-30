// deobfuscated.js
let input = '';

process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  main();
});

function main() {
  let debt = 100000;               // 0x186a0
  const n = parseInt(input.trim(), 10);

  for (let i = 0; i < n; i++) {
    debt = Math.ceil((debt * 1.05) / 1000) * 1000;
  }

  console.log(debt);
}
