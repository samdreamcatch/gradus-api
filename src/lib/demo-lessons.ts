/**
 * The demo coach's lesson schedule (Admin → Membership → Demo accounts).
 *
 * One-hour lessons every two hours from 9am to 5pm, every day of the week,
 * so the coach's Up next briefing is always on Roster → Schedule during the
 * day. The app shows that card from two hours before a lesson until it ends,
 * which puts it on screen from 7am to 6pm. Times are wall-clock minutes: the
 * app reads them in the device's own timezone.
 *
 * Side effect: the "{First} is up next" push (lesson-reminders.server.ts,
 * New York time) reaches the demo coach's devices before each lesson.
 */
export const DEMO_LESSON_START_HOURS = [9, 11, 13, 15, 17] as const;
export const DEMO_LESSON_MINUTES = 60;

export type DemoLessonSlotRow = {
  athlete_id: string;
  coach_id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: "weekly";
  weeks_of_month: number[];
  starts_on: null;
};

export function demoLessonSlots(athleteId: string, coachId: string): DemoLessonSlotRow[] {
  const rows: DemoLessonSlotRow[] = [];
  for (let day = 0; day < 7; day++) {
    for (const hour of DEMO_LESSON_START_HOURS) {
      rows.push({
        athlete_id: athleteId,
        coach_id: coachId,
        day_of_week: day,
        start_minute: hour * 60,
        end_minute: hour * 60 + DEMO_LESSON_MINUTES,
        frequency: "weekly",
        weeks_of_month: [],
        starts_on: null,
      });
    }
  }
  return rows;
}
