import test from "node:test";
import assert from "node:assert/strict";
import { Deadline, pool } from "../lib/http.ts";

test("Deadline.cancel zera o prazo e marca como cancelado", () => {
  const d = new Deadline(60_000);
  assert.equal(d.cancelled, false);
  assert.equal(d.expired(1000), false);
  d.cancel();
  assert.equal(d.cancelled, true);
  assert.equal(d.remaining(), 0);
  assert.equal(d.expired(), true);
});

test("pool para de pegar novas tarefas depois do cancelamento", async () => {
  const d = new Deadline(60_000);
  const seen: number[] = [];
  await pool([1, 2, 3, 4, 5, 6], 1, async (n) => {
    seen.push(n);
    if (n === 2) d.cancel();
  }, d);
  assert.deepEqual(seen, [1, 2]);
});
