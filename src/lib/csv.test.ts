import { expect, it } from 'vitest'
import { toCsv } from './csv'

it('quotes, escapes, keeps negative amounts, neutralises formulas', () => {
  expect(toCsv([{ note: 'a, "b"', amount: '-0.50', x: null, f: '=HYPERLINK("x")' }])).toBe(
    '\uFEFF"note","amount","x","f"\r\n"a, ""b""","-0.50","","\'=HYPERLINK(""x"")"\r\n')
})
