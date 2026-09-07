-- A link is a verb between two records, how sure and since when. The bag
-- of extra values it could carry was declared nowhere, checked nowhere and
-- read nowhere.
alter table edges drop column props;
