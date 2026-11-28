import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z
    .string()
    .regex(/^\/[a-zA-Z0-9/_-]*$/)
    .default("/api/v1"),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a valid PostgreSQL connection URL"
    ),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("Events <no-reply@example.com>"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(1440)
    .default(30),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(120)
    .default(30),
  IDENTITY_EMAIL_RATE_LIMIT_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw new Error(
      `Invalid environment configuration: ${JSON.stringify(details)}`
    );
  }
  return result.data;
}
