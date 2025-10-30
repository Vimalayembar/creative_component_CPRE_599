// deobfuscated.js
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(input) {
  // read all lines and drop the first (count)
  const lines = input.toString().split('\n');
  lines.shift(); // remove first line (usually T)

  for (const line of lines) {
    if (!line.trim()) continue;               // skip empty lines
    // parse three numbers
    const nums = line.trim().split(/\s+/).map(x => Number(x));
    // sort ascending
    nums.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const a = nums[0], b = nums[1], c = nums[2];

    if (a === b * c) {
      console.log('YES');
    } else {
      console.log('NO');
    }
  }
});
