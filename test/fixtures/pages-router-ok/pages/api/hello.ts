export default function handler(_req: unknown, res: { json(v: unknown): void }) {
  res.json({ ok: true });
}
