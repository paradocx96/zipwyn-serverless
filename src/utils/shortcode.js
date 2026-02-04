import {nanoid} from 'nanoid';

// Generate a 7-character code (62^7 = 3.5 trillion combinations)
export const generateShortCode = () => nanoid(7);

// Validate short code format
export const isValidShortCode = (code) => /^[A-Za-z0-9_-]{7}$/.test(code);
