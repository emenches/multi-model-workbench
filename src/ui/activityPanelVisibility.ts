/** Activity begins closed for every selected conversation, including history. */
export function activityPanelForSession(): boolean {
  return false;
}

/** Open on the first accepted send in the currently selected conversation.
 *  After that, preserve a user's manual decision to close the panel. */
export function activityPanelAfterSend(currentlyOpen: boolean, alreadySentInSelectedSession: boolean): boolean {
  return !alreadySentInSelectedSession || currentlyOpen;
}
