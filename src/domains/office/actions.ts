/** Action kinds owned by the office domain (compatibility test). */
export const OFFICE_ACTIONS = {
  openTask: 'office.openTask',
} as const;

export interface OpenTaskPayload {
  taskId: string;
}
