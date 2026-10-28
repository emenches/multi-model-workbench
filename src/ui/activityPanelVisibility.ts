/** Empty sessions hide Activity; sessions with messages reveal it by default. */
export function activityPanelForSession(messageCount: number): boolean {
  return messageCount > 0;
}

/** Auto-open only for the first accepted prompt. After that, respect Close. */
export function activityPanelAfterSend(currentlyOpen: boolean, messageCountBeforeSend: number): boolean {
  return messageCountBeforeSend === 0 || currentlyOpen;
}
