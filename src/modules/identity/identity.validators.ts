import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(120).optional()
  }),
  params: z.object({}),
  query: z.object({})
});

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1).max(128)
  }),
  params: z.object({}),
  query: z.object({})
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(32).max(512)
  }),
  params: z.object({}),
  query: z.object({})
});

export const organizationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160)
  }),
  params: z.object({}),
  query: z.object({})
});
