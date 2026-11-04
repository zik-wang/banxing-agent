// Host-supervisor tests only. No model calls, network access or private files.
const mode = process.argv[2];
if (mode === 'fast') process.stdout.write('done');
else if (mode === 'blocked') {
  process.stdout.write('blocking\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  process.stdout.write('late-success');
} else if (mode === 'output') process.stdout.write('x'.repeat(32768));
else if (mode === 'failed') process.exitCode = 7;
else throw Error('Unknown synthetic mode');
