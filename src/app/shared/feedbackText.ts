export function feedbackText(message: string, preservePunctuation = false): string {
  const text = message.trim().toLowerCase()
    .replace(/\bcould not\b/g, "couldn't")
    .replace(/\bplease try again\b/g, "try again");
  return preservePunctuation ? text : text.replace(/[.!]+$/, "");
}
