import { z } from 'zod';
import { isValidCellId } from './hex';
import { isValidDayKey, isValidMonthKey } from './time';
import { CREW_COLORS, LIMITS } from './constants';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits');
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,20}$/, 'Use 3 to 20 letters, numbers, dots or underscores');
export const displayNameSchema = z.string().trim().min(1).max(40);
export const cellSchema = z.string().refine(isValidCellId, 'Invalid cell id');
export const daySchema = z.string().refine(isValidDayKey, 'Invalid day');
export const monthSchema = z.string().refine(isValidMonthKey, 'Invalid month');
export const crewColorSchema = z.enum(CREW_COLORS);
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,8}$/, 'Invalid code');

export const otpRequestBody = z.object({ email: emailSchema });
export const otpVerifyBody = z.object({ email: emailSchema, code: otpCodeSchema });

export const profilePatchBody = z
  .object({
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    cityId: z.string().min(1).max(16).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const visitsBody = z.object({
  visits: z
    .array(z.object({ cell: cellSchema, day: daySchema }))
    .min(1)
    .max(LIMITS.visitsPerRequest),
});

export const forgetCellsBody = z.object({ cells: z.array(cellSchema).min(1).max(5000) });

/** Encrypted memory backup, base64. Capped at 8 MB of ciphertext. */
export const MEMORY_BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const memoryBackupBody = z.object({
  data: z
    .string()
    .min(40)
    .max(Math.ceil((MEMORY_BACKUP_MAX_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64'),
});

export const crewCreateBody = z.object({ name: z.string().trim().min(2).max(30), color: crewColorSchema });
export const crewPatchBody = z.object({
  name: z.string().trim().min(2).max(30).optional(),
  color: crewColorSchema.optional(),
  rotateInviteCode: z.boolean().optional(),
});
export const codeBody = z.object({ code: inviteCodeSchema });

export const dropCreateBody = z.object({
  cell: cellSchema,
  title: z.string().trim().min(3).max(60),
  note: z.string().trim().max(280).optional(),
});

export const adminDropBody = z.object({
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
  title: z.string().trim().min(3).max(60),
  note: z.string().trim().max(280).optional(),
  kind: z.enum(['venue', 'quest']),
  sponsor: z.string().trim().min(1).max(60),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
});

export const adminChallengeBody = z
  .object({
    name: z.string().trim().min(3).max(60),
    cityId: z.string().min(1).max(16),
    startsOn: daySchema,
    endsOn: daySchema,
    teams: z
      .array(z.object({ name: z.string().trim().min(2).max(40), color: crewColorSchema }))
      .min(2)
      .max(50),
  })
  .refine((v) => v.endsOn >= v.startsOn, 'endsOn must be on or after startsOn');

export type OtpRequestBody = z.infer<typeof otpRequestBody>;
export type OtpVerifyBody = z.infer<typeof otpVerifyBody>;
export type ProfilePatchBody = z.infer<typeof profilePatchBody>;
export type VisitsBody = z.infer<typeof visitsBody>;
export type ForgetCellsBody = z.infer<typeof forgetCellsBody>;
export type CrewCreateBody = z.infer<typeof crewCreateBody>;
export type CrewPatchBody = z.infer<typeof crewPatchBody>;
export type DropCreateBody = z.infer<typeof dropCreateBody>;
export type AdminDropBody = z.infer<typeof adminDropBody>;
export type AdminChallengeBody = z.infer<typeof adminChallengeBody>;
