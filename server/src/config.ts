export type Config = {
  nodeEnv: string;
  port: number;
  host: string;
  databaseUrl: string;
  databaseSsl: boolean;
  adminApiKey: string | null;
  otpPepper: string;
  resendApiKey: string | null;
  emailFrom: string;
  /** Returns the one-time code in the API response. Development and tests only. */
  devReturnOtp: boolean;
  /** Fixed login for App Store and Play Store reviewers. */
  reviewEmail: string | null;
  reviewCode: string | null;
  trustProxy: boolean;
  /** Per-IP and per-session request limits. Only disable in tests. */
  rateLimit: boolean;
  logLevel: string;
};

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const otpPepper = env.OTP_PEPPER ?? (isProd ? '' : 'dev-pepper-change-me');
  if (isProd && otpPepper.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters in production');

  const devReturnOtp = bool(env.DEV_RETURN_OTP);
  if (isProd && devReturnOtp) throw new Error('DEV_RETURN_OTP must not be enabled in production');

  const resendApiKey = env.RESEND_API_KEY || null;
  if (isProd && !resendApiKey) throw new Error('RESEND_API_KEY is required in production to send sign-in codes');

  const adminApiKey = env.ADMIN_API_KEY || null;
  if (adminApiKey !== null && adminApiKey.length < 24) throw new Error('ADMIN_API_KEY must be at least 24 characters');

  const reviewEmail = env.REVIEW_LOGIN_EMAIL?.trim().toLowerCase() || null;
  const reviewCode = env.REVIEW_LOGIN_CODE?.trim() || null;
  if ((reviewEmail === null) !== (reviewCode === null)) {
    throw new Error('Set both REVIEW_LOGIN_EMAIL and REVIEW_LOGIN_CODE, or neither');
  }
  if (reviewCode !== null && !/^\d{6}$/.test(reviewCode)) throw new Error('REVIEW_LOGIN_CODE must be 6 digits');

  return {
    nodeEnv,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl,
    databaseSsl: bool(env.DATABASE_SSL),
    adminApiKey,
    otpPepper,
    resendApiKey,
    emailFrom: env.EMAIL_FROM ?? 'Haunts <login@unfog.app>',
    devReturnOtp,
    reviewEmail,
    reviewCode,
    trustProxy: bool(env.TRUST_PROXY, isProd),
    rateLimit: isProd ? true : bool(env.RATE_LIMIT, true),
    logLevel: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  };
}
