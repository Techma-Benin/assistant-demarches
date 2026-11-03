import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveReply, stableEnd } from "../dist/apps/backend/src/live-reply.js";
import { redact } from "../dist/apps/backend/src/model.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const envelope = (text) => JSON.stringify({ blocks: [{ type: "text", text, sources: [] }] });
const observed = [{ procedureId: "PS00373", url: "https://service-public.bj/public/services/service/PS00373" }];

/** What the user could see after each provider chunk, for one way of cutting the model output. */
async function run(text, cuts) {
  const published = [];
  const fake = {
    pool: { async query() { return { rows: [] }; } },
    async appendDelta(_c, _m, delta) { published.push(delta); return 1; },
  };
  const live = new LiveReply(fake, "cnv", "msg", tp, 0);
  const listener = await live.attempt(observed);
  const body = envelope(text);
  const seen = [];
  let from = 0;
  for (const cut of [...cuts, body.length]) {
    listener.onTextDelta(body.slice(from, cut));
    from = cut;
    await live.settle();
    seen.push(published.join(""));
  }
  const beforeComplete = published.join("");
  listener.complete(body);
  await live.settle();
  await live.close();
  return { seen, beforeComplete, final: published.join("") };
}

const cases = [
  ["email", "Écrivez à ada.lovelace@exemple.bj pour la suite.", ["ada", "lovelace", "@exemple", "exemple.bj"]],
  ["email at the end", "Mon adresse est ada@exemple.bj", ["ada@", "exemple.bj"]],
  ["phone with spaces", "Appelez le +229 97 00 11 22 demain.", ["+229", "97 00", "11 22"]],
  ["phone with dashes", "Numéro 97-00-11-22-33 merci", ["97-00", "11-22"]],
  ["npi", "Mon NPI est 1234567890 voilà", ["1234567890"]],
  ["npi colon", "NPI: 1234567890 et la suite", ["1234567890"]],
  ["otp", "Le code SMS 482913 expire", ["482913"]],
  ["password", "Votre mot de passe : S3cret!x ok", ["S3cret"]],
  ["several", "Écrivez à ada@exemple.bj ou appelez le 97 00 11 22, NPI 1234567890, merci", ["ada@", "exemple", "97 00", "1234567890"]],
  ["keyword after a number", "Le 97 00 11 22 33 puis OTP 482913 enfin", ["97 00", "482913"]],
];

test("stableEnd holds back the last word and anything that may become sensitive", () => {
  assert.equal(stableEnd("Bonjour "), "Bonjour ".length);
  assert.equal(stableEnd("Bonjour mon"), "Bonjour ".length);
  assert.equal(stableEnd("ada@ex"), 0);
  assert.equal(stableEnd("Appelez le +229 97 00 "), "Appelez le ".length);
  assert.equal(stableEnd("Appelez le 97 00 11 22 et"), "Appelez le 97 00 11 22 ".length);
  assert.equal(stableEnd("Mon NPI "), "Mon ".length);
  assert.equal(stableEnd("Mon NPI est"), "Mon ".length, "the value after the keyword is still being typed");
  assert.equal(stableEnd("Votre mot de "), "Votre ".length);
  assert.equal(stableEnd("Votre code "), "Votre ".length);
  assert.equal(stableEnd("Votre code postal "), "Votre code postal ".length);
  assert.equal(stableEnd(""), 0);
});

test("live deltas never carry raw sensitive data, however the provider cuts the text", async () => {
  for (const [label, text, secrets] of cases) {
    const body = envelope(text);
    const start = body.indexOf(text);
    const masked = redact(text);
    assert.notEqual(masked, text, label + ": the sample is sensitive");
    const everyCut = Array.from({ length: text.length }, (_, index) => start + index + 1); // one character per chunk
    const twoWay = Array.from({ length: text.length }, (_, index) => [start + index + 1]);
    for (const cuts of [everyCut, ...twoWay, []]) {
      const { seen, final } = await run(text, cuts);
      for (const shown of seen.slice(0, -1).concat(final)) {
        for (const secret of secrets) assert.equal(shown.includes(secret), false, `${label}: "${shown}" shows "${secret}"`);
        assert.equal(masked.startsWith(shown), true, `${label}: "${shown}" is a prefix of the masked text`);
      }
      assert.equal(final, masked, label + ": the whole masked text is streamed in the end");
    }
  }
});

test("the held-back tail is released at the end of the stream, but not for a broken stream", async () => {
  const text = "Merci pour votre confiance";
  const body = envelope(text);
  const { beforeComplete, final } = await run(text, [body.indexOf(text) + 10]);
  assert.equal(beforeComplete, "Merci pour votre ", "the unfinished last word waits");
  assert.equal(final, text);

  // A stream that stopped inside an address (and was retried elsewhere) never releases its partial tail.
  const published = [];
  const fake = { pool: { async query() { return { rows: [] }; } }, async appendDelta(_c, _m, delta) { published.push(delta); return 1; } };
  const live = new LiveReply(fake, "cnv", "msg", tp, 0);
  const listener = await live.attempt(observed);
  listener.onTextDelta(envelope("Écrivez à ada@exemple.b").slice(0, -"\",\"sources\":[]}]}".length));
  await live.settle();
  listener.complete(envelope("Écrivez à ada@exemple.bj, merci"));
  await live.settle();
  await live.close();
  assert.equal(published.join(""), "Écrivez à ");
});

test("the first delta still leaves at once", async () => {
  const published = [];
  const fake = { pool: { async query() { return { rows: [] }; } }, async appendDelta(_c, _m, delta) { published.push({ delta, at: performance.now() }); return 1; } };
  const live = new LiveReply(fake, "cnv", "msg", tp, 0);
  const listener = await live.attempt();
  const start = performance.now();
  listener.onTextDelta('{"blocks":[{"type":"text","text":"Bonjour ');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(published.length, 1);
  assert.equal(published[0].delta, "Bonjour ");
  assert.ok(published[0].at - start < 20);
  await live.close();
});

test("fuzz: for every prefix of a random sentence, the masked stable part is a prefix of the final masked text and never shrinks", () => {
  let seed = 20261102;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const parts = [
    "Bonjour", "voici", "la", "démarche", "mot", "de", "passe", "code", "SMS", "NPI", "OTP", "otp", "npi",
    "ada@exemple.bj", "ada.lovelace@ex.example.org", "+229 97 00 11 22", "97 00 11 22 33", "0197001122", "(229) 97-00-11-22",
    "1234567890", "482913", "15", "FCFA", "demain,", "merci.", ":", "=", "-", "(", ")", "12", "3", "S3cret!", "https://service-public.bj/x",
  ];
  for (let round = 0; round < 400; round++) {
    const words = Array.from({ length: 3 + Math.floor(random() * 14) }, () => pick(parts));
    const text = words.join(random() < 0.2 ? "  " : " ");
    const masked = redact(text);
    let previous = 0;
    for (let length = 1; length <= text.length; length++) {
      const prefix = text.slice(0, length);
      const end = stableEnd(prefix);
      assert.ok(end >= previous, `monotone for "${text}" at ${length}`);
      previous = end;
      const shown = redact(prefix.slice(0, end));
      assert.equal(masked.startsWith(shown), true, `"${shown}" must be a prefix of "${masked}" (text "${text}", at ${length})`);
    }
  }
});
