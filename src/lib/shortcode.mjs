import {randomInt} from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 62^7 is roughly 3.5 trillion combinations. */
export const SHORT_CODE_LENGTH = 7;

/** Generates a cryptographically random, URL-safe short code. */
export const generateShortCode = (length = SHORT_CODE_LENGTH) => {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
};
