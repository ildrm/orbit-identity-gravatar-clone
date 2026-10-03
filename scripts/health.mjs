const controller = new AbortController();
setTimeout(() => controller.abort(), 4000).unref();
try {
  const r = await fetch(process.argv[2], { signal: controller.signal });
  process.exit(r.ok ? 0 : 1);
} catch {
  process.exit(1);
}
