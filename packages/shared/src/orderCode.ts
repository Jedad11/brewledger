// Public order-code alphabet (WBS 2.6): short, human-readable, unambiguous —
// no 0/O, no 1/I.
export const ORDER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ORDER_CODE_LENGTH = 6;

export function isValidOrderCode(code: string): boolean {
  if (code.length !== ORDER_CODE_LENGTH) return false;
  return [...code].every((c) => ORDER_CODE_ALPHABET.includes(c));
}
