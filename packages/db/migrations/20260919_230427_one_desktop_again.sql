-- One desktop again: the desktop a window was on, and the one a filled
-- window came from, are taken off every saved window, so all of them lie
-- on the one desktop there is.
update desktops
set layout = jsonb_set(
  layout,
  '{cards}',
  (select coalesce(jsonb_agg(c - 'desk' - 'home'), '[]'::jsonb)
   from jsonb_array_elements(layout -> 'cards') c)
)
where jsonb_typeof(layout -> 'cards') = 'array'
  and exists (
    select 1 from jsonb_array_elements(layout -> 'cards') c
    where c ? 'desk' or c ? 'home'
  );
