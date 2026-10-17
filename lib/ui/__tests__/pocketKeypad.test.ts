import { describe, expect, it } from "vitest";
import {
  clampDecimals,
  decimalMark,
  displayExpression,
  evaluate,
  hasOperator,
  KeypadKey,
  normalizeDecimal,
  press,
  tokenize,
  typedFromExpression,
} from "../pocket/keypad";
import { Currency } from "@/lib/domain/currencies";

/** Type a sequence of keys on a fresh keypad. */
function typeKeys(keys: KeypadKey[], currency: Currency = "TRY"): string {
  return keys.reduce((expr, key) => press(expr, key, currency), "");
}
const keys = (s: string) => [...s] as KeypadKey[];

describe("tokenize", () => {
  it("splits numbers and operators, ASCII lookalikes included", () => {
    expect(tokenize("120+45")).toEqual([
      { kind: "num", text: "120" },
      { kind: "op", op: "+" },
      { kind: "num", text: "45" },
    ]);
    expect(tokenize("12*3-6/2")?.filter((t) => t.kind === "op").map((t) => (t as { op: string }).op)).toEqual(["×", "−", "÷"]);
  });

  it("refuses anything that isn't a sum", () => {
    expect(tokenize("12a")).toBeNull();
    expect(tokenize("alert(1)")).toBeNull();
  });
});

describe("evaluate", () => {
  it("adds, and does × and ÷ before + and −", () => {
    expect(evaluate("120+45", "TRY")).toEqual({ ok: true, value: 165 });
    expect(evaluate("12×3−6", "TRY")).toEqual({ ok: true, value: 30 });
    expect(evaluate("2+3×4", "USD")).toEqual({ ok: true, value: 14 });
    expect(evaluate("10−4−3", "USD")).toEqual({ ok: true, value: 3 });
    expect(evaluate("100÷4×2", "USD")).toEqual({ ok: true, value: 50 });
  });

  it("rounds to the currency's precision, without float noise", () => {
    expect(evaluate("0.1+0.2", "USD")).toEqual({ ok: true, value: 0.3 });
    expect(evaluate("100÷3", "TRY")).toEqual({ ok: true, value: 33.33 });
    expect(evaluate("1÷3", "BTC")).toEqual({ ok: true, value: 0.33333333 });
    expect(evaluate("10÷3", "XAU_G")).toEqual({ ok: true, value: 3.33 });
  });

  it("rejects division by zero instead of returning Infinity", () => {
    expect(evaluate("5÷0", "TRY")).toEqual({ ok: false, reason: "divZero" });
    expect(evaluate("5÷0.0", "TRY")).toEqual({ ok: false, reason: "divZero" });
  });

  it("ignores an operator still waiting for its number", () => {
    expect(evaluate("120+", "TRY")).toEqual({ ok: true, value: 120 });
    expect(evaluate("", "TRY")).toEqual({ ok: false, reason: "empty" });
    expect(evaluate("12.", "TRY")).toEqual({ ok: true, value: 12 });
  });

  it("can go to zero or below, which the sheet won't save", () => {
    expect(evaluate("5−5", "TRY")).toEqual({ ok: true, value: 0 });
    expect(evaluate("5−8", "TRY")).toEqual({ ok: true, value: -3 });
  });

  it("refuses what the database can't store", () => {
    expect(evaluate("999999999999×10", "TRY")).toEqual({ ok: false, reason: "tooBig" });
    expect(evaluate("+5", "TRY")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("press", () => {
  it("builds an expression from keys", () => {
    expect(typeKeys(keys("120+45"))).toBe("120+45");
    expect(typeKeys(["1", "2", "×", "3", "−", "6"])).toBe("12×3−6");
  });

  it("stores '.' whatever the decimal key shows", () => {
    expect(decimalMark("tr")).toBe(",");
    expect(decimalMark("en")).toBe(".");
    expect(typeKeys(["1", "2", ".", "5"])).toBe("12.5");
  });

  it("starts a bare decimal with 0 and allows one mark per number", () => {
    expect(typeKeys([".", "5"])).toBe("0.5");
    expect(typeKeys(["1", ".", ".", "2"])).toBe("1.2");
    expect(typeKeys(["1", ".", "2", "+", "3", ".", "4"])).toBe("1.2+3.4");
  });

  it("stops at the currency's decimals: 2 for lira, 8 for bitcoin", () => {
    expect(typeKeys(keys("1.2345"), "TRY")).toBe("1.23");
    expect(typeKeys(keys("0.123456789"), "BTC")).toBe("0.12345678");
  });

  it("never starts with an operator, and a second one replaces the first", () => {
    expect(typeKeys(["+", "5"])).toBe("5");
    expect(typeKeys(["5", "+", "×", "2"])).toBe("5×2");
    expect(typeKeys(["5", ".", "+", "2"])).toBe("5+2");
  });

  it("drops a leading zero", () => {
    expect(typeKeys(["0", "0", "7"])).toBe("7");
    expect(typeKeys(["0", ".", "0", "7"])).toBe("0.07");
  });

  it("removes one key with ⌫ and everything with clear", () => {
    expect(press("120+45", "back", "TRY")).toBe("120+4");
    expect(press("120+", "back", "TRY")).toBe("120");
    expect(press("", "back", "TRY")).toBe("");
    expect(press("120+45", "clear", "TRY")).toBe("");
  });

  it("caps a number at twelve whole digits", () => {
    expect(typeKeys(keys("12345678901234"))).toBe("123456789012");
  });
});

describe("hasOperator", () => {
  it("is true only once an operator sits between two numbers", () => {
    expect(hasOperator("120")).toBe(false);
    expect(hasOperator("120+")).toBe(false);
    expect(hasOperator("120+4")).toBe(true);
  });
});

describe("clampDecimals", () => {
  it("cuts every number to the currency's decimals", () => {
    expect(clampDecimals("1.239+4.5", "TRY")).toBe("1.23+4.5");
    expect(clampDecimals("0.123456789", "BTC")).toBe("0.12345678");
  });
});

describe("normalizeDecimal", () => {
  it("reads either decimal mark and thousands, as the Classic forms do", () => {
    expect(normalizeDecimal("12.465,50", "TRY")).toBe("12465.5");
    expect(normalizeDecimal("12,465.50", "TRY")).toBe("12465.5");
    expect(normalizeDecimal("35,5", "TRY")).toBe("35.5");
    expect(normalizeDecimal("₺1.250", "TRY")).toBe("1250");
    expect(normalizeDecimal("0,00012345", "BTC")).toBe("0.00012345");
  });

  it("turns typed operators into the keypad's", () => {
    expect(normalizeDecimal("120 + 45,5", "TRY")).toBe("120+45.5");
    expect(normalizeDecimal("12*3-6", "TRY")).toBe("12×3−6");
    expect(normalizeDecimal("100/4", "TRY")).toBe("100÷4");
    expect(normalizeDecimal("120+", "TRY")).toBe("120+");
  });

  it("gives null for what can't be read", () => {
    expect(normalizeDecimal("abc", "TRY")).toBeNull();
    expect(normalizeDecimal("+5", "TRY")).toBeNull();
    expect(normalizeDecimal("1,2,3.4.5", "TRY")).toBeNull();
    expect(normalizeDecimal("", "TRY")).toBe("");
  });

  it("round-trips the keypad's own text in either language", () => {
    for (const locale of ["en", "tr"]) {
      expect(normalizeDecimal(typedFromExpression("1234.5+0.25", locale), "TRY")).toBe("1234.5+0.25");
    }
  });
});

describe("displayExpression", () => {
  it("groups thousands and shows the locale's decimal mark, keeping what was typed", () => {
    expect(displayExpression("12465.5+45", "en")).toBe("12,465.5 + 45");
    expect(displayExpression("12465.5+45", "tr")).toBe("12.465,5 + 45");
    expect(displayExpression("120.", "tr")).toBe("120,");
    expect(displayExpression("0.50", "en")).toBe("0.50");
    expect(displayExpression("120+", "en")).toBe("120 +");
  });
});
