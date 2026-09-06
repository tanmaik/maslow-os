// What a record's or an edge's id looks like: ten characters from an
// alphabet with no i, l, o or u, made by the database.
export const ID = /^[0-9a-hjkmnp-tv-z]{10}$/;

export const isId = (s: string) => ID.test(s);
