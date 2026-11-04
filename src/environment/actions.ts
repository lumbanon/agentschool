/** Action kinds owned by the environment layer (usable from any world definition). */
export const ENVIRONMENT_ACTIONS = {
  toggleLights: 'environment.toggleLights',
} as const;

/** Dialogue placeholders the environment fills in, e.g. "{malaysiaTime}". */
export const ENVIRONMENT_VARS = ['malaysiaTime', 'timeOfDay', 'windowView'] as const;
