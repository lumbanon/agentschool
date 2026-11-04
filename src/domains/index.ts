import type { PanelRegistry } from '../app/panels';
import { SCHOOL_ACTIONS } from './school/actions';
import { LessonPanel } from './school/LessonPanel';
import { OFFICE_ACTIONS } from './office/actions';
import { TaskPanel } from './office/TaskPanel';

/** Each domain registers its panels by action kind. Adding a domain never touches the engine. */
export const DOMAIN_PANELS: PanelRegistry = {
  [SCHOOL_ACTIONS.openLesson]: LessonPanel,
  [OFFICE_ACTIONS.openTask]: TaskPanel,
};
