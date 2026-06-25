let uid = 0;

export function genId(): string {
  return (
    Date.now().toString(36) +
    (++uid).toString(36) +
    Math.random().toString(36).slice(2, 6)
  );
}
