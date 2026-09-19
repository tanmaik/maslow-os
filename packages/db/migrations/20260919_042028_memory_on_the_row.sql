-- What a computer's memory was at the last sweep and the most it has
-- been since its size was last set, so the size is chosen from what
-- people use rather than guessed.
alter table computers add column memory_used_mb int,
  add column memory_peak_mb int;
