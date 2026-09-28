import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_CONFIG, sanitizeConfig } from "../../src/discounts/config.ts";
import type { WonDiscountsConfig } from "../../src/discounts/config.ts";
import {
  encodeFunctionConfig,
  FUNCTION_CONFIG_BUDGET_BYTES,
} from "../../src/discounts/function-config.ts";

test("the default config fits comfortably under the function budget", () => {
  const encoded = encodeFunctionConfig(DEFAULT_CONFIG);
  assert.equal(encoded.fits, true);
  assert.ok(encoded.bytes < FUNCTION_CONFIG_BUDGET_BYTES);
});

function configWithNRules(n: number): WonDiscountsConfig {
  const { config } = sanitizeConfig({
    modules: {
      codes: {
        rules: Array.from({ length: n }, (_, i) => ({
          id: `rule-${i}`,
          enabled: true,
          name: `Discount rule number ${i} with a reasonably descriptive name`,
          method: "automatic",
          value: { kind: "percentage", percent: 10 },
          target: { kind: "order" },
        })),
      },
    },
  });
  return config;
}

test("400 rules blow the 9000 B function-config budget", () => {
  const encoded = encodeFunctionConfig(configWithNRules(400));
  assert.equal(encoded.fits, false);
  assert.ok(encoded.bytes > FUNCTION_CONFIG_BUDGET_BYTES);
});

test("bytes are counted as UTF-8, not UTF-16 code units", () => {
  const ascii = configWithNRules(0);
  const withAscii: WonDiscountsConfig = {
    ...ascii,
    modules: {
      ...ascii.modules,
      codes: {
        rules: [
          {
            id: "r1",
            enabled: true,
            name: "Kc",
            method: "automatic",
            value: { kind: "percentage", percent: 10 },
            target: { kind: "order" },
          },
        ],
      },
    },
  };
  const withNonAscii: WonDiscountsConfig = {
    ...withAscii,
    modules: {
      ...withAscii.modules,
      codes: {
        rules: [{ ...withAscii.modules.codes.rules[0], name: "Kč" }],
      },
    },
  };

  const encAscii = encodeFunctionConfig(withAscii);
  const encNonAscii = encodeFunctionConfig(withNonAscii);

  // "Kc" and "Kč" are the same JS string length (2 UTF-16 code units)...
  assert.equal(encAscii.json.length, encNonAscii.json.length);
  // ...but "č" is 2 bytes in UTF-8 vs "c"'s 1 byte, so the byte count must differ.
  assert.equal(encNonAscii.bytes - encAscii.bytes, 1);
});
