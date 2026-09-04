-- Files live on the person's disk, the volume their machine serves. The
-- files table holds only what is on its way there: an upload staged in the
-- bucket until the machine has pulled it. Folders are the disk's own.
drop table folders;
