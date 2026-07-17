import bcrypt from 'bcryptjs';

// bcryptjs is pure-JS (no native build) — reliable on Windows. argon2 can be swapped in later.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
