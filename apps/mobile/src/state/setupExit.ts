// Set by the setup screen while it saves and leaves for Food, so the Gate does not send the new profile on to Targets.
// The Gate clears it once the app is off /setup. A profile that arrives from a sync mid-setup does not set it.
let leaving = false;

export const setupLeaving = (): boolean => leaving;
export const setSetupLeaving = (v: boolean): void => void (leaving = v);
