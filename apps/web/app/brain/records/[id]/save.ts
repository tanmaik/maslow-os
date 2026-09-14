// Posts one change to a record as the page saves it, and answers with the
// record's last change once it landed, or with what went wrong. A save
// that fell behind — the record changed since the page last saw it — is
// said as such.
export type Trouble = { said: string; behind: boolean };

export async function save(
  id: string,
  fields: Record<string, string>,
): Promise<number | Trouble> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const res = await fetch(`/brain/records/${id}/change`, {
      method: "POST",
      body: form,
      headers: { accept: "application/json" },
    });
    if (res.ok) return ((await res.json()) as { seen: number }).seen;
    const said = await res.text();
    return {
      said:
        res.status < 500 && said
          ? said
          : "That change did not save. Try again.",
      behind: res.status === 409,
    };
  } catch {
    return { said: "That change did not save. Try again.", behind: false };
  }
}

// The number of the last change to a record, as the server has it, or
// null when it could not be asked.
export async function lastChange(id: string): Promise<number | null> {
  try {
    const res = await fetch(`/brain/records/${id}/change`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { seen: number }).seen;
  } catch {
    return null;
  }
}
