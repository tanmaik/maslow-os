// Thrown when a record is edited from a version that is no longer current.
export class Conflict extends Error {}

// Thrown when a call names a record, type or field the brain does not have.
export class NotFound extends Error {}

// Thrown when a write does not fit the form its type declares.
export class Invalid extends Error {}

// Thrown when a member may see a record but not do this to it.
export class Forbidden extends Error {}
