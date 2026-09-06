-- What a machine last said it needed is kept as lists, newest last; what
-- was kept as one number is let go, and the next report starts the lists.
update computers set need = null
 where jsonb_typeof(need -> 'load') = 'number'
    or jsonb_typeof(need -> 'memory' -> 'free') = 'number';
