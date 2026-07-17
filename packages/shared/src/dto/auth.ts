import { z } from 'zod';
import { ROLES } from '../enums.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: (typeof ROLES)[number];
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}
