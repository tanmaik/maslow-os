// Posts one change to a record as the page saves it, and answers with
// what went wrong, or null.
export async function save(
  id: string,
  fields: Record<string, string>,
): Promise<string | null> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const res = await fetch(`/brain/records/${id}/change`, {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
    });
    if (res.ok) return null;
    const said = await res.text();
    return res.status < 500 && said
      ? said
      : "That change did not save. Try again.";
  } catch {
    return "That change did not save. Try again.";
  }
}
