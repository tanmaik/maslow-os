-- How much an object signed for and not yet landed will weigh, so it
-- counts against its shared thing's ceiling before it is there.
alter table orphans add column bytes bigint;
