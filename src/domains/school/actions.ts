/** Action kinds owned by the school domain. Engine treats these as opaque strings. */
export const SCHOOL_ACTIONS = {
  openLesson: 'school.openLesson',
} as const;

export interface OpenLessonPayload {
  lessonId: string;
  startAt?: 'board' | 'exercise';
}
