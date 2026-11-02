import { z } from "zod";

/** One inbox row (src/lib/notifications.server.ts `NotificationDTO`). */
export const notificationSchema = z.object({
  id: z.string(),
  /** The push `gradus.type`: message, plan_assigned, lesson_reminder, … */
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  /** The push `gradus.route`; the apps open it with `RouteParser.route(fromPath:)`. */
  route: z.string().nullable(),
  actorUserId: z.string().nullable(),
  athleteId: z.string().nullable(),
  /** Events folded into this row (e.g. 3 new messages in one room); 1 otherwise. */
  count: z.number(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationsPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});

export const unreadNotificationCountSchema = z.object({ count: z.number() });
