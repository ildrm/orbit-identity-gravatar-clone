const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
const deadline = Date.now() + 120_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const result = await fetch(origin + '/health/ready', { signal: AbortSignal.timeout(2_000) });
    await result.arrayBuffer();
    if (result.ok) {
      process.stdout.write('Reverse-proxy readiness passed.\n');
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!ready) throw new Error('Reverse-proxy readiness timed out');
