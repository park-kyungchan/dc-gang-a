/** Printed identifier conversion only. A decoded key is not lookup or identity proof. */
export const PAPER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function decodePaperCode(code: string): string {
  if (!/^#[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{1,11}$/.test(code) || code[1] === '2') {
    throw new Error('invalid_printed_paper_code');
  }
  let key = 0n;
  for (const character of code.slice(1)) key = key * 32n + BigInt(PAPER_CODE_ALPHABET.indexOf(character));
  if (key <= 0n || key > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe_printed_paper_key');
  return key.toString();
}
export function encodePaperCode(key: string): string {
  if (!/^[1-9][0-9]{0,15}$/.test(key)) throw new Error('invalid_printed_paper_key');
  let value = BigInt(key);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe_printed_paper_key');
  let code = '';
  while (value > 0n) {
    code = PAPER_CODE_ALPHABET[Number(value % 32n)]! + code;
    value /= 32n;
  }
  return '#' + code;
}
